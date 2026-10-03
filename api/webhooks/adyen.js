import { env } from '../_supabase.js';
import { HttpError, method, readRawBody, sendError } from '../../lib/http.js';
import { verifyAdyen } from '../../lib/signatures.js';
import { processPaymentEvent, processRefund } from '../../lib/payments.js';
import { toMinor } from '../../lib/money.js';

export const config = { api: { bodyParser: false } };

function outcomeOf(i) {
  const ok = String(i.success) === 'true';
  if (i.eventCode === 'AUTHORISATION') return ok ? 'paid' : 'failed';
  if (i.eventCode === 'CANCELLATION' && ok) return 'cancelled';
  return null;
}

export default async function handler(req, res) {
  try {
    method(req, ['POST']);
    const raw = await readRawBody(req);
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }

    const key = env('ADYEN_HMAC_KEY');
    const merchant = env('ADYEN_MERCHANT_ACCOUNT');
    const items = (body.notificationItems || []).map((n) => n.NotificationRequestItem).filter(Boolean);

    // Tout vérifier avant de traiter quoi que ce soit.
    for (const i of items) {
      if (i.merchantAccountCode !== merchant || !verifyAdyen(i, key)) throw new HttpError(401, 'Invalid signature');
    }

    for (const i of items) {
      if (i.eventCode === 'REFUND' && String(i.success) === 'true') {
        await processRefund({
          provider: 'adyen',
          refundId: i.pspReference,
          orderId: i.merchantReference,
          amountMajor: Number(i.amount?.value) / (10 ** (i.amount?.currency === 'JPY' ? 0 : 2)),
          currency: i.amount?.currency,
          payload: i,
          status: 'succeeded',
        });
        continue;
      }
      const outcome = outcomeOf(i);
      if (!outcome) continue;
      await processPaymentEvent({
        provider: 'adyen',
        eventId: `${i.pspReference}:${i.eventCode}:${i.success}`,
        orderId: i.merchantReference, // merchantReference = id de la commande
        outcome,
        amountMinor: Number(i.amount?.value),
        currency: i.amount?.currency,
        payload: i,
        paymentReference: i.pspReference || null,
      });
    }

    // Adyen exige exactement "[accepted]".
    return res.status(200).setHeader('Content-Type', 'text/plain').end('[accepted]');
  } catch (e) {
    return sendError(res, e);
  }
}
