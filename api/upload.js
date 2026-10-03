import { createHmac, createHash, randomUUID } from 'node:crypto';
import { requireUser, env } from './_supabase.js';
import { HttpError, json, method, sendError } from '../lib/http.js';
import { rateLimitAsync as rateLimit } from '../lib/ratelimit.js';

/**
 * Génère une URL présignée (PUT) pour Cloudflare R2 (API S3-compatible).
 * Le client envoie ensuite le fichier en PUT avec Content-Type.
 */

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    try { body = JSON.parse(String(body) || '{}'); } catch { throw new HttpError(400, 'Invalid JSON body'); }
  }
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Invalid body');
  return body;
}

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_SIZE = 5 * 1024 * 1024; // 5 Mo

export default async function handler(req, res) {
  try {
    method(req, ['POST']);
    const { user } = await requireUser(req);
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || user.id;
    const rl = await rateLimit(`upload:${ip}`, { limit: 30, windowMs: 60_000 });
    if (!rl.ok) throw new HttpError(429, `Too many requests. Retry in ${rl.retryAfter}s`);
    const body = parseBody(req);

    const contentType = String(body.content_type || '').toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) throw new HttpError(400, 'Unsupported content type');
    const size = Number(body.size || 0);
    if (!Number.isFinite(size) || size < 1 || size > MAX_SIZE) {
      throw new HttpError(400, `File size must be between 1 and ${MAX_SIZE} bytes`);
    }

    const accountId = env('R2_ACCOUNT_ID');
    const bucket = env('R2_BUCKET_NAME');
    const accessKey = env('R2_ACCESS_KEY_ID');
    const secretKey = env('R2_SECRET_ACCESS_KEY');
    const publicBase = process.env.R2_PUBLIC_BASE_URL || '';

    const ext = contentType === 'image/png' ? 'png'
      : contentType === 'image/webp' ? 'webp'
      : contentType === 'image/gif' ? 'gif' : 'jpg';
    const key = `uploads/${user.id}/${randomUUID()}.${ext}`;
    const host = `${accountId}.r2.cloudflarestorage.com`;
    const path = `/${bucket}/${key}`;
    const region = 'auto';
    const service = 's3';
    const now = new Date();
    const expires = 300; // 5 min

    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

    const query = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${accessKey}/${credentialScope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expires),
      'X-Amz-SignedHeaders': 'content-type;host',
    };

    const payloadHash = 'UNSIGNED-PAYLOAD';
    const signedHeaders = 'content-length;content-type;host';
    const canonicalHeaders = `content-length:${size}\ncontent-type:${contentType}\nhost:${host}\n`;
    const canonicalQuery = Object.keys(query)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
      .join('&');

    const canonicalRequest = ['PUT', path, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
    const kDate = hmac(`AWS4${secretKey}`, dateStamp);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, service);
    const kSigning = hmac(kService, 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    const uploadUrl = `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
    const publicUrl = publicBase
      ? `${publicBase.replace(/\/$/, '')}/${key}`
      : `https://${host}/${bucket}/${key}`;

    return json(res, 200, {
      ok: true,
      upload_url: uploadUrl,
      public_url: publicUrl,
      key,
      content_type: contentType,
      expires_in: expires,
    });
  } catch (e) {
    return sendError(res, e);
  }
}
