import { adminClient } from '../api/_supabase.js';
import { UUID_RE } from './validate.js';
import { payoutAmount, paymentMatchesOrder } from './money.js';
import { notifyOrderPaid } from './email.js';

/**
 * Crée la ligne de versement vendeur si elle n'existe pas encore (idempotent, sans erreur silencieuse).
 * Lève une erreur si l'écriture échoue, afin que le webhook soit rejoué par le prestataire.
 */
export async function ensurePayout(db, order, provider) {
  const { data: existing, error: selErr } = await db
    .from('payouts')
    .select('id')
    .eq('order_id', order.id)
    .limit(1)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) return { created: false };

  const { error } = await db.from('payouts').insert({
    order_id: order.id,
    shop_id: order.shop_id,
    provider,
    amount: payoutAmount(order),
    currency: order.currency,
    // 'paid' seulement si un transfert Connect automatique a eu lieu ; sinon la plateforme détient les fonds.
    status: order.transfer_destination ? 'paid' : 'pending',
  });
  if (error) {
    if (error.code === '23505') return { created: false }; // course : déjà créé
    throw error;
  }
  return { created: true };
}

/**
 * Argent reçu mais commande inexploitable : on journalise pour traitement manuel (remboursement...).
 * Ne lève jamais : le webhook doit répondre 200, l'anomalie est visible en base et dans les logs.
 */
async function recordAnomaly(db, { order, provider, kind, eventId, amountMinor, currency }) {
  console.error(JSON.stringify({
    level: 'error', msg: 'payment_anomaly', kind, provider,
    order_id: order?.id ?? null, event_id: eventId, amount_minor: amountMinor, currency,
  }));
  try {
    const { error } = await db.from('payment_anomalies').insert({
      order_id: order?.id ?? null,
      provider,
      kind,
      provider_event_id: `${provider}:${eventId}`,
      amount_minor: Number.isFinite(amountMinor) ? amountMinor : null,
      currency: currency ? String(currency).toUpperCase() : null,
      details: order ? { order_status: order.status, order_total: order.total, order_currency: order.currency } : null,
    });
    if (error) console.error('[payment_anomalies] insert failed', error.message || error);
  } catch (e) {
    console.error('[payment_anomalies] insert failed', e?.message || e);
  }
}

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
    if (!order) {
      if (outcome === 'paid') await recordAnomaly(db, { order: null, provider, kind: 'paid_unknown_order', eventId, amountMinor, currency });
      return { status: 'no_order' };
    }

    if (order.status !== 'pending') {
      // Rejeu après un échec d'écriture du versement : on le recrée sans toucher à la commande.
      if (order.status === 'paid' && outcome === 'paid') {
        await ensurePayout(db, order, provider);
        return { status: 'already_final' };
      }

      // Paiement reçu APRÈS l'annulation/expiration : le client a payé, on honore la commande
      // si le stock peut être re-réservé ; sinon anomalie à rembourser.
      if (outcome === 'paid' && (order.status === 'cancelled' || order.status === 'failed')) {
        if (!paymentMatchesOrder(order, amountMinor, currency).ok) {
          await recordAnomaly(db, { order, provider, kind: 'late_payment_mismatch', eventId, amountMinor, currency });
          return { status: 'mismatch' };
        }
        const { data: reopened, error: reopenErr } = await db.rpc('reopen_order_for_late_payment', { p_order: order.id });
        if (reopenErr) throw reopenErr;
        if (!reopened) {
          await recordAnomaly(db, { order, provider, kind: 'late_payment_no_stock', eventId, amountMinor, currency });
          return { status: 'late_payment_refund_needed' };
        }
        order = { ...order, status: 'pending' };
        console.info(JSON.stringify({ level: 'info', msg: 'order_reopened_late_payment', order_id: order.id, provider }));
      } else {
        return { status: 'already_final' };
      }
    }

    if (outcome === 'paid') {
      const { ok, expected } = paymentMatchesOrder(order, amountMinor, currency);
      if (!ok) {
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
        await recordAnomaly(db, { order, provider, kind: 'amount_mismatch', eventId, amountMinor, currency });
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

      // Le versement vendeur ne doit jamais échouer en silence : on tente aussi l'email,
      // puis on relève l'erreur pour que le prestataire rejoue le webhook (ensurePayout est idempotent).
      let payoutErr = null;
      try {
        await ensurePayout(db, order, provider);
      } catch (e) {
        payoutErr = e;
        console.error(JSON.stringify({
          level: 'error',
          msg: 'payout_insert_failed',
          order_id: order.id,
          shop_id: order.shop_id,
          provider,
          error: e?.message || String(e),
        }));
      }

      try {
        await notifyOrderPaid(db, order);
      } catch (e) {
        console.error('[email] notifyOrderPaid', e?.message || e);
      }

      if (payoutErr) throw payoutErr;

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
export async function expirePendingOrders({ olderThanMinutes = 60, limit = 100 } = {}) {
  const db = adminClient();
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();

  const { data: orders, error } = await db
    .from('orders')
    .select('id')
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .limit(limit);
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
