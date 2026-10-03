import { publicClient } from './_supabase.js';
import { HttpError, json, method, sendError } from '../lib/http.js';
import { previewShipping } from '../lib/checkout.js';
import { rateLimitAsync as rateLimit } from '../lib/ratelimit.js';
import labelHandler from '../lib/label-handler.js';

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    try { body = JSON.parse(String(body) || '{}'); } catch { throw new HttpError(400, 'Invalid JSON body'); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid body');
  return body;
}

/**
 * POST /api/shipping
 * Body: { items: [{product_id, quantity}], shipping_address: { line1, city, country, ... } }
 */
export default async function handler(req, res) {
  if (String(req.query?.action || '') === 'label') return labelHandler(req, res);
  try {
    method(req, ['POST']);

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
    const rl = await rateLimit(`shipping:${ip}`, { limit: 30, windowMs: 60_000 });
    if (!rl.ok) throw new HttpError(429, `Too many requests. Retry in ${rl.retryAfter}s`);

    const body = parseBody(req);
    const result = await previewShipping({
      items: body.items,
      shippingAddress: body.shipping_address,
      express: Boolean(body.express),
    });
    return json(res, 200, { ok: true, ...result });
  } catch (e) {
    return sendError(res, e);
  }
}
