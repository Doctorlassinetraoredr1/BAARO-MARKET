import { requireUser, adminClient, env } from './_supabase.js';
import { HttpError, json, method, sendError } from '../lib/http.js';
import { UUID_RE } from '../lib/validate.js';
import { toMinor } from '../lib/money.js';
import { processRefund } from '../lib/payments.js';
import { rateLimitAsync as rateLimit } from '../lib/ratelimit.js';

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    try { body = JSON.parse(String(body) || '{}'); } catch { throw new HttpError(400, 'Invalid JSON body'); }
  }
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Invalid body');
  return body;
}

/**
 * POST /api/refund
 * Body: { order_id, amount?, reason? }
 * - Acheteur ou propriétaire de la boutique uniquement.
 * - amount omis = remboursement total restant.
 * - Crée le refund Stripe puis enregistre en base (webhook peut aussi confirmer).
 */
export default async function handler(req, res) {
  try {
    method(req, ['POST']);
    const { user } = await requireUser(req);

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || user.id;
    const rl = await rateLimit(`refund:${ip}`, { limit: 10, windowMs: 60_000 });
    if (!rl.ok) throw new HttpError(429, `Too many requests. Retry in ${rl.retryAfter}s`);

    const body = parseBody(req);
    if (!UUID_RE.test(String(body.order_id || ''))) throw new HttpError(400, 'Invalid order_id');

    const db = adminClient();
    const { data: order, error } = await db
      .from('orders')
      .select('id,buyer_id,shop_id,status,currency,total,refunded_amount,payment_provider,payment_intent_id,stripe_payment_intent,payment_provider_reference,transfer_destination')
      .eq('id', body.order_id)
      .single();
    if (error) throw error;
    if (!['paid', 'partially_refunded'].includes(order.status)) {
      throw new HttpError(400, 'Order is not refundable');
    }

    const { data: shop } = await db.from('shops').select('owner_id').eq('id', order.shop_id).single();
    // Seul le vendeur décide d'un remboursement (l'acheteur le demande au vendeur).
    if (user.id !== shop?.owner_id) {
      throw new HttpError(403, 'Forbidden');
    }

    const already = Number(order.refunded_amount) || 0;
    const remaining = Math.round((Number(order.total) - already) * 100) / 100;
    let amount = body.amount !== undefined ? Number(body.amount) : remaining;
    amount = Math.round(amount * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0 || amount > remaining + 0.001) {
      throw new HttpError(400, 'Invalid refund amount');
    }

    const reason = body.reason ? String(body.reason).slice(0, 500) : undefined;

    // Stripe refund si possible
    if (order.payment_provider === 'stripe' && order.payment_intent_id) {
      const secret = env('STRIPE_SECRET_KEY');
      // payment_intent_id peut être une session id (cs_...) — récupérer le payment_intent
      let pi = order.stripe_payment_intent || order.payment_intent_id;
      if (pi.startsWith('cs_')) {
        const sr = await fetch(`https://api.stripe.com/v1/checkout/sessions/${pi}`, {
          headers: { Authorization: `Bearer ${secret}` },
        });
        const session = await sr.json();
        if (!sr.ok) throw new HttpError(502, session.error?.message || 'Stripe session fetch failed');
        pi = session.payment_intent;
      }
      if (!pi) throw new HttpError(400, 'No payment intent to refund');

      const params = new URLSearchParams({
        payment_intent: pi,
        amount: String(toMinor(amount, order.currency)),
        'metadata[order_id]': order.id,
      });
      if (reason) params.set('reason', 'requested_by_customer');
      if (order.transfer_destination) {
        params.set('reverse_transfer', 'true');
        params.set('refund_application_fee', 'true');
      }

      const rr = await fetch('https://api.stripe.com/v1/refunds', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      const refund = await rr.json();
      if (!rr.ok) throw new HttpError(502, refund.error?.message || 'Stripe refund failed');

      const result = await processRefund({
        provider: 'stripe',
        refundId: refund.id,
        orderId: order.id,
        amountMajor: amount,
        currency: order.currency,
        reason,
        payload: refund,
        status: refund.status === 'succeeded' ? 'succeeded' : refund.status === 'failed' ? 'failed' : 'pending',
      });
      return json(res, 200, { ok: true, ...result, stripe_refund_id: refund.id });
    }

    if (order.payment_provider === 'paypal') {
      const clientId = env('PAYPAL_CLIENT_ID');
      const clientSecret = env('PAYPAL_CLIENT_SECRET');
      const base = (process.env.PAYPAL_BASE_URL || 'https://api-m.paypal.com').replace(/\/$/, '');
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tr = await fetch(`${base}/v1/oauth2/token`, {
        method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      });
      const td = await tr.json();
      if (!tr.ok) throw new HttpError(502, td.error_description || 'PayPal auth failed');
      const paypalOrderId = order.payment_provider_reference || order.payment_intent_id;
      const or = await fetch(`${base}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`, { headers: { Authorization: `Bearer ${td.access_token}` } });
      const od = await or.json();
      if (!or.ok) throw new HttpError(502, od.message || 'PayPal order lookup failed');
      const capture = (od.purchase_units || []).flatMap((u) => u.payments?.captures || []).find((c) => c.status === 'COMPLETED');
      if (!capture?.id) throw new HttpError(409, 'No completed PayPal capture available for refund');
      const params = { amount: { value: amount.toFixed(2), currency_code: order.currency }, note_to_payer: reason || undefined };
      const rr = await fetch(`${base}/v2/payments/captures/${encodeURIComponent(capture.id)}/refund`, {
        method: 'POST', headers: { Authorization: `Bearer ${td.access_token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `refund-${order.id}-${Date.now()}` }, body: JSON.stringify(params),
      });
      const refund = await rr.json();
      if (!rr.ok) throw new HttpError(502, refund.message || 'PayPal refund failed');
      const result = await processRefund({
        provider: 'paypal', refundId: refund.id, orderId: order.id, amountMajor: amount, currency: order.currency, reason, payload: refund,
        status: refund.status === 'COMPLETED' ? 'succeeded' : 'pending',
      });
      return json(res, 200, { ok: true, ...result, paypal_refund_id: refund.id });
    }

    if (order.payment_provider === 'adyen') {
      const apiKey = env('ADYEN_API_KEY');
      const base = (process.env.ADYEN_CHECKOUT_BASE_URL || 'https://checkout-test.adyen.com').replace(/\/$/, '');
      const pspReference = order.payment_provider_reference;
      if (!pspReference) throw new HttpError(409, 'Missing Adyen PSP reference; wait for payment confirmation webhook');
      const rr = await fetch(`${base}/v71/payments/${encodeURIComponent(pspReference)}/refunds`, {
        method: 'POST', headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json', 'Idempotency-Key': `refund-${order.id}-${amount}-${order.refunded_amount || 0}` },
        body: JSON.stringify({ merchantAccount: env('ADYEN_MERCHANT_ACCOUNT'), amount: { currency: order.currency, value: toMinor(amount, order.currency) }, reference: `refund-${order.id}-${Date.now()}`, metadata: { order_id: order.id } }),
      });
      const refund = await rr.json();
      if (!rr.ok) throw new HttpError(502, refund.message || refund.errorCode || 'Adyen refund failed');
      const result = await processRefund({
        provider: 'adyen', refundId: refund.pspReference || refund.reference, orderId: order.id, amountMajor: amount, currency: order.currency, reason, payload: refund, status: 'pending',
      });
      return json(res, 202, { ok: true, ...result, adyen_psp_reference: refund.pspReference || null });
    }

    throw new HttpError(409, `Unsupported payment provider for refund: ${order.payment_provider || 'unknown'}`);
  } catch (e) {
    return sendError(res, e);
  }
}
