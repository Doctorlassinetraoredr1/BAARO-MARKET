export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function json(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(payload));
}

export function method(req, allowed) {
  if (!allowed.includes(req.method)) throw new HttpError(405, 'Method not allowed');
}

// Codes PostgreSQL / PostgREST -> réponse HTTP propre (jamais de message SQL brut au client).
const PG_ERRORS = {
  '23505': [409, 'Already exists'],
  '23503': [400, 'Invalid reference'],
  '23514': [400, 'Invalid value'],
  '22P02': [400, 'Invalid value'],
  '42501': [403, 'Forbidden'],
  P0001: [409, 'Insufficient stock'],
  PGRST116: [404, 'Not found'],
};

export function sendError(res, e) {
  if (res.headersSent) return;
  if (e instanceof HttpError) return json(res, e.status, { ok: false, error: e.message });
  const mapped = PG_ERRORS[e?.code];
  if (mapped) return json(res, mapped[0], { ok: false, error: mapped[1] });
  console.error(e);
  return json(res, 500, { ok: false, error: 'Internal error' });
}

const MAX_BODY = 1024 * 1024; // 1 Mo

// Corps brut (obligatoire pour vérifier les signatures de webhooks).
export async function readRawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buf.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Payload too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}
