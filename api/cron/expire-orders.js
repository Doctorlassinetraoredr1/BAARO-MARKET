import { json, method, sendError, HttpError } from '../../lib/http.js';
import { expirePendingOrders } from '../../lib/payments.js';

/**
 * Cron Vercel : annule les commandes pending > N minutes et restaure le stock.
 * Sécurisé par CRON_SECRET (Authorization: Bearer …) ou header Vercel-Cron.
 */
export default async function handler(req, res) {
  try {
    method(req, ['GET', 'POST']);

    const secret = process.env.CRON_SECRET;
    const auth = req.headers.authorization || '';
    // x-vercel-cron est falsifiable : seul le secret fait foi (Vercel l'envoie en Bearer si CRON_SECRET est défini).
    const ok = Boolean(secret) && auth === `Bearer ${secret}`;
    if (!ok) throw new HttpError(401, 'Unauthorized');

    const minutes = Number(process.env.ORDER_PENDING_TTL_MINUTES || 60);
    const result = await expirePendingOrders({ olderThanMinutes: minutes });
    return json(res, 200, { ok: true, ...result, ttl_minutes: minutes });
  } catch (e) {
    return sendError(res, e);
  }
}
