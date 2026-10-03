import { json } from '../lib/http.js';

export default function handler(req, res) {
  return json(res, 200, {
    ok: true,
    service: 'BAARO-MARKET API',
    version: '2.0.0',
    architecture: 'Vercel + Supabase + Cloudflare R2',
    timestamp: new Date().toISOString()
  });
}
