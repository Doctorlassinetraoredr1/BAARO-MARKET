import { env, adminClient } from '../_supabase.js';
import { HttpError, json, method, readRawBody, sendError } from '../../lib/http.js';
import { verifyStripe } from '../../lib/signatures.js';
import { processPaymentEvent, processRefund } from '../../lib/payments.js';
import { minorDigits } from '../../lib/money.js';

export const config = { api: { bodyParser: false } };

const SESSION_OUTCOMES = {
  'checkout.session.completed': (o) => (o.payment_status === 'paid' ? 'paid' : null),
  'checkout.session.async_payment_succeeded': () => 'paid',
  'checkout.session.async_payment_failed': () => 'failed',
  'checkout.session.expired': () => 'cancelled',
};

export default async function handler(req, res) {
  try {
    method(req, ['POST']);
    const raw = await readRawBody(req);
    if (!verifyStripe(raw, req.headers['stripe-signature'], env('STRIPE_WEBHOOK_SECRET'))) {
      throw new HttpError(400, 'Invalid signature');
    }
    const event = JSON.parse(raw.toString('utf8'));
    const obj = event.data?.object || {};

    // Remboursements : l'objet est un Refund (id re_..., payment_intent, amount, currency).
    if (event.type === 'refund.created' || event.type === 'refund.updated') {
      if (obj.status !== 'succeeded') return json(res, 200, { ok: true, ignored: true });
      let orderId = obj.metadata?.order_id || null;
      if (!orderId && obj.payment_intent) {
        const { data } = await adminClient().from('orders').select('id').eq('stripe_payment_intent', obj.payment_intent).maybeSingle();
        orderId = data?.id || null;
      }
      const currency = String(obj.currency || '').toUpperCase();
      const result = await processRefund({
        provider: 'stripe',
        refundId: obj.id,
        orderId,
        amountMajor: Number(obj.amount) / 10 ** minorDigits(currency || 'USD'),
        currency,
        reason: obj.reason || null,
        payload: event,
      });
      return json(res, 200, { ok: true, ...result });
    }

    const outcome = SESSION_OUTCOMES[event.type]?.(obj);
    if (!outcome) return json(res, 200, { ok: true, ignored: true });

    const result = await processPaymentEvent({
      provider: 'stripe',
      eventId: event.id,
      orderId: obj.client_reference_id || obj.metadata?.order_id,
      outcome,
      amountMinor: obj.amount_total,
      currency: obj.currency,
      payload: event,
      paymentIntent: typeof obj.payment_intent === 'string' ? obj.payment_intent : null,
    });
    return json(res, 200, { ok: true, ...result });
  } catch (e) {
    return sendError(res, e);
  }
}
