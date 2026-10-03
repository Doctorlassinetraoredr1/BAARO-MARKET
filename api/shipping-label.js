import { adminClient, requireUser } from './_supabase.js';
import { HttpError, json, method, sendError } from '../lib/http.js';
import { purchaseShippoLabel, isShippoConfigured } from '../lib/carriers/shippo.js';
import { UUID_RE } from '../lib/validate.js';
import { rateLimitAsync as rateLimit } from '../lib/ratelimit.js';

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    try { body = JSON.parse(String(body) || '{}'); } catch { throw new HttpError(400, 'Invalid JSON body'); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid body');
  return body;
}

/**
 * POST /api/shipping-label
 * Body: { order_id } — achète l'étiquette Shippo si rate_id présent sur la commande.
 */
export default async function handler(req, res) {
  try {
    method(req, ['POST']);
    const { user } = await requireUser(req);
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || user.id;
    const rl = await rateLimit(`label:${ip}`, { limit: 10, windowMs: 60_000 });
    if (!rl.ok) throw new HttpError(429, `Too many requests. Retry in ${rl.retryAfter}s`);

    if (!isShippoConfigured()) throw new HttpError(503, 'Shippo not configured');

    const body = parseBody(req);
    if (!UUID_RE.test(String(body.order_id || ''))) throw new HttpError(400, 'Invalid order_id');

    const admin = adminClient();
    const { data: order, error } = await admin
      .from('orders')
      .select('id,shop_id,status,shipping_rate_id,tracking_number,shops!inner(owner_id)')
      .eq('id', body.order_id)
      .maybeSingle();
    if (error) throw error;
    if (!order) throw new HttpError(404, 'Order not found');
    if (order.shops.owner_id !== user.id) throw new HttpError(403, 'Not your shop order');
    if (order.status !== 'paid' && order.status !== 'partially_refunded') {
      throw new HttpError(400, 'Order must be paid');
    }
    if (!order.shipping_rate_id) throw new HttpError(400, 'No carrier rate_id on this order (table rates cannot print labels)');
    if (order.tracking_number) {
      return json(res, 200, { ok: true, already: true, tracking_number: order.tracking_number });
    }

    // Claim atomique : une seule requête peut acheter l'étiquette pour cette commande.
    const leaseCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: claimed, error: claimErr } = await admin
      .from('orders')
      .update({ label_purchase_started_at: new Date().toISOString() })
      .eq('id', order.id)
      .is('tracking_number', null)
      .or(`label_purchase_started_at.is.null,label_purchase_started_at.lt.${leaseCutoff}`)
      .select('id')
      .maybeSingle();
    if (claimErr) throw claimErr;
    if (!claimed) throw new HttpError(409, 'Shipping label purchase already in progress');

    let label;
    try {
      label = await purchaseShippoLabel(order.shipping_rate_id);
    } catch (e) {
      await admin.from('orders').update({ label_purchase_started_at: null }).eq('id', order.id);
      throw e;
    }
    await admin.from('orders').update({
      tracking_number: label.tracking_number,
      tracking_url: label.tracking_url,
      label_url: label.label_url,
      label_purchase_started_at: null,
    }).eq('id', order.id);

    await admin.from('shipments').insert({
      order_id: order.id,
      shop_id: order.shop_id,
      provider: 'shippo',
      rate_id: order.shipping_rate_id,
      tracking_number: label.tracking_number,
      tracking_url: label.tracking_url,
      label_url: label.label_url,
      status: label.status === 'SUCCESS' ? 'purchased' : 'failed',
      raw: label,
    });

    return json(res, 200, { ok: true, ...label });
  } catch (e) {
    return sendError(res, e);
  }
}
