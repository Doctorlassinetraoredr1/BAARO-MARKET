import { env } from '../_supabase.js';
import { HttpError, json, method, readRawBody, sendError } from '../../lib/http.js';
import { toMinor } from '../../lib/money.js';
import { processPaymentEvent } from '../../lib/payments.js';

export const config = { api: { bodyParser: false } };

async function accessToken(base) {
  const basic = Buffer.from(`${env('PAYPAL_CLIENT_ID')}:${env('PAYPAL_CLIENT_SECRET')}`).toString('base64');
  const r = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error(`PayPal OAuth failed (${r.status})`);
  return (await r.json()).access_token;
}

async function verifySignature(headers, event) {
  const base = env('PAYPAL_BASE_URL');
  const r = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken(base)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: env('PAYPAL_WEBHOOK_ID'),
      webhook_event: event,
    }),
  });
  if (!r.ok) throw new Error(`PayPal verification call failed (${r.status})`);
  return (await r.json()).verification_status === 'SUCCESS';
}

/** Capture une commande PayPal APPROVED. */
async function captureOrder(orderId) {
  const base = env('PAYPAL_BASE_URL');
  const token = await accessToken(base);
  const r = await fetch(`${base}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `capture-${orderId}`,
    },
  });
  const data = await r.json();
  if (!r.ok && data.name !== 'ORDER_ALREADY_CAPTURED') {
    console.error('[paypal] capture failed', data);
    throw new HttpError(502, data.message || 'PayPal capture failed');
  }
  return data;
}

function extractOrderId(resource) {
  return (
    resource.custom_id ||
    resource.purchase_units?.[0]?.custom_id ||
    resource.supplementary_data?.related_ids?.order_id ||
    null
  );
}

export default async function handler(req, res) {
  try {
    method(req, ['POST']);
    const raw = await readRawBody(req);
    let event;
    try {
      event = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new HttpError(400, 'Invalid JSON');
    }
    if (!(await verifySignature(req.headers, event))) throw new HttpError(400, 'Invalid signature');

    const r = event.resource || {};

    // Après approve : capturer pour déclencher PAYMENT.CAPTURE.COMPLETED
    if (event.event_type === 'CHECKOUT.ORDER.APPROVED') {
      const paypalOrderId = r.id;
      if (paypalOrderId) {
        try {
          await captureOrder(paypalOrderId);
        } catch (e) {
          console.error('[paypal] auto-capture', e?.message || e);
        }
      }
      return json(res, 200, { ok: true, captured: true });
    }

    if (event.event_type === 'PAYMENT.CAPTURE.REFUNDED' && r.status === 'COMPLETED') {
      const orderId = extractOrderId(r);
      const amount = r.amount;
      const result = await processRefund({
        provider: 'paypal',
        refundId: r.id,
        orderId,
        amountMajor: amount ? Number(amount.value) : NaN,
        currency: amount?.currency_code,
        payload: event,
        status: 'succeeded',
      });
      return json(res, 200, { ok: true, ...result });
    }

    let outcome = null;
    if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED' && r.status === 'COMPLETED') outcome = 'paid';
    else if (event.event_type === 'PAYMENT.CAPTURE.DENIED' || event.event_type === 'PAYMENT.CAPTURE.DECLINED') {
      outcome = 'failed';
    } else if (event.event_type === 'CHECKOUT.ORDER.VOIDED') {
      outcome = 'cancelled';
    }

    if (!outcome) return json(res, 200, { ok: true, ignored: true });

    const orderId = extractOrderId(r);
    const amount = r.amount || r.purchase_units?.[0]?.amount;
    const result = await processPaymentEvent({
      provider: 'paypal',
      eventId: event.id,
      orderId,
      outcome,
      amountMinor: amount ? toMinor(amount.value, amount.currency_code) : NaN,
      currency: amount?.currency_code,
      payload: event,
      paymentReference: r.supplementary_data?.related_ids?.order_id || r.id || null,
    });
    return json(res, 200, { ok: true, ...result });
  } catch (e) {
    return sendError(res, e);
  }
}
