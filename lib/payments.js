import { adminClient } from '../api/_supabase.js';
import { UUID_RE } from './validate.js';
import { toMinor } from './money.js';
import { notifyOrderPaid } from './email.js';

/**
 * Applique un événement de paiement vérifié (signature déjà contrôlée par l'appelant).
 *  - idempotent : provider_event_id est unique ;
 *  - 'paid' seulement si montant ET devise correspondent ;
 *  - seules les commandes 'pending' changent de statut ;
 *  - failed/cancelled : restauration du stock.
 * outcome : 'paid' | 'failed' | 'cancelled'
 */
export async function processPaymentEvent({ provider, eventId, orderId, outcome, amountMinor, currency, payload, paymentIntent = null, paymentReference = null }) {
  const db = adminClient();
  const validId = typeof orderId === 'string' && UUID_RE.test(orderId) ? orderId : null;

  let order = null;
  if (validId) {
    const { data, error } = await db
      .from('orders')
      .select('id,status,currency,subtotal,total,platform_fee,shop_id,buyer_id,transfer_destination')
      .eq('id', validId)
      .maybeSingle();
    if (error) throw error;
    order = data;
  }

  const { error: claimErr } = await db.from('payment_events').insert({
    order_id: order?.id ?? null,
    provider,
    provider_event_id: `${provider}:${eventId}`,
    payload,
  });
  if (claimErr) {
    if (claimErr.code === '23505') return { status: 'duplicate' };
    throw claimErr;
  }

  try {
    if (!order) return { status: 'no_order' };
    if (order.status !== 'pending') return { status: 'already_final' };

    if (outcome === 'paid') {
      const expected = order.total != null ? toMinor(order.total, order.currency) : toMinor(order.subtotal, order.currency);
      const amountOk = Number.isFinite(amountMinor) && amountMinor === expected;
      const currencyOk = String(currency).toUpperCase() === String(order.currency).trim().toUpperCase();
      if (!amountOk || !currencyOk) {
        console.error(JSON.stringify({
          level: 'error',
          msg: 'payment_mismatch',
          order_id: order.id,
          provider,
          event_id: eventId,
          expected,
          got: amountMinor,
          currency_expected: order.currency,
          currency_got: currency,
        }));
        return { status: 'mismatch' };
      }

      const { error } = await db
        .from('orders')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          payment_provider: provider,
          stripe_payment_intent: paymentIntent,
          payment_provider_reference: paymentReference || paymentIntent || null,
        })
        .eq('id', order.id)
        .eq('status', 'pending');
      if (error) throw error;

      {
        const sellerAmount = Math.round((Number(order.total) - Number(order.platform_fee || 0)) * 100) / 100;
        await db.from('payouts').insert({
          order_id: order.id,
          shop_id: order.shop_id,
          provider,
          amount: sellerAmount,
          currency: order.currency,
          // 'paid' seulement si un transfert Connect automatique a eu lieu ; sinon la plateforme détient les fonds.
          status: order.transfer_destination ? 'paid' : 'pending',
        });
      }

      try {
        await notifyOrderPaid(db, order);
      } catch (e) {
        console.error('[email] notifyOrderPaid', e?.message || e);
      }

      console.info(JSON.stringify({ level: 'info', msg: 'order_paid', order_id: order.id, provider }));
      return { status: 'paid' };
    }

    const { error } = await db.rpc('close_pending_order', { p_order: order.id, p_status: outcome });
    if (error) throw error;
    console.info(JSON.stringify({ level: 'info', msg: 'order_final', order_id: order.id, status: outcome, provider }));
    return { status: outcome };
  } catch (e) {
    await db.from('payment_events').delete().eq('provider_event_id', `${provider}:${eventId}`);
    throw e;
  }
}

async function restoreStock(db, orderId) {
  const { data: items } = await db.from('order_items').select('product_id,quantity').eq('order_id', orderId);
  if (items?.length) await db.rpc('release_items', { p_items: items });
}

/**
 * Enregistre un remboursement (partiel ou total).
 * amountMajor = montant en unités majeures (ex. 10.50).
 */
export async function processRefund({ provider, refundId, orderId, amountMajor, currency, reason, payload, status = 'succeeded' }) {
  const db = adminClient();
  const validId = typeof orderId === 'string' && UUID_RE.test(orderId) ? orderId : null;
  if (!validId) return { status: 'no_order' };

  const amount = Math.round(Number(amountMajor) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return { status: 'bad_amount' };

  const cur = String(currency || '').toUpperCase();
  if (!cur) return { status: 'currency_mismatch' };

  const { data, error } = await db.rpc('apply_refund', {
    p_order: validId,
    p_provider: String(provider),
    p_refund_id: String(refundId),
    p_amount: amount,
    p_currency: cur,
    p_reason: reason || null,
    p_status: status,
    p_payload: payload || { refundId, amount, currency: cur },
  });
  if (error) throw error;
  return data || { status: 'unknown' };
}

/**
 * Annule les commandes pending trop anciennes et restaure le stock.
 */
export async function expirePendingOrders({ olderThanMinutes = 60 } = {}) {
  const db = adminClient();
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();

  const { data: orders, error } = await db
    .from('orders')
    .select('id')
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .limit(100);
  if (error) throw error;
  if (!orders?.length) return { expired: 0 };

  let expired = 0;
  for (const o of orders) {
    const { data: closed, error: cErr } = await db.rpc('close_pending_order', { p_order: o.id, p_status: 'cancelled' });
    if (!cErr && closed) expired += 1;
  }
  console.info(JSON.stringify({ level: 'info', msg: 'orders_expired', count: expired }));
  return { expired };
}
