import { requireUser, adminClient } from './_supabase.js';
import { HttpError, json, method, sendError } from '../lib/http.js';
import { createOrdersFromItems, orderAmountMinor } from '../lib/checkout.js';
import { createPaymentSession } from '../lib/providers.js';
import { rateLimitAsync as rateLimit } from '../lib/ratelimit.js';

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    try { body = JSON.parse(String(body) || '{}'); } catch { throw new HttpError(400, 'Invalid JSON body'); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid body');
  return body;
}

async function rollbackOrders(orders) {
  const db = adminClient();
  for (const { order } of orders) {
    try {
      await db.rpc('close_pending_order', { p_order: order.id, p_status: 'failed' });
    } catch (e) {
      console.error('[checkout] rollback', order.id, e?.message || e);
    }
  }
}

export default async function handler(req, res) {
  try {
    method(req, ['POST']);
    const { user } = await requireUser(req);

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || user.id;
    const rl = await rateLimit(`checkout:${ip}`, { limit: 15, windowMs: 60_000 });
    if (!rl.ok) throw new HttpError(429, `Too many requests. Retry in ${rl.retryAfter}s`);

    const body = parseBody(req);
    const items = body.items;
    const shippingAddress = body.shipping_address || null;
    const shippingTotal = body.shipping_total != null ? body.shipping_total : null;
    const provider = String(body.provider || 'stripe').toLowerCase();
    const autoShipping = body.auto_shipping !== false;
    const express = Boolean(body.express);

    if (!['stripe', 'paypal', 'adyen'].includes(provider)) {
      throw new HttpError(400, 'provider must be stripe, paypal or adyen');
    }

    const { orders: created, multi } = await createOrdersFromItems({
      buyerId: user.id,
      items,
      shippingAddress,
      shippingTotal,
      autoShipping,
      express,
    });

    const checkouts = [];
    try {
      for (const { order, items: orderItems, shop, shippingQuote } of created) {
        const session = await createPaymentSession(provider, order, shop, orderItems);
        await adminClient()
          .from('orders')
          .update({
            payment_provider: provider,
            payment_intent_id: session.payment_intent_id || session.session_id,
          })
          .eq('id', order.id);

        checkouts.push({
          order_id: order.id,
          shop_id: shop.id,
          shop_name: shop.name,
          total: order.total,
          currency: order.currency,
          shipping_total: order.shipping_total,
          shipping_quote: shippingQuote,
          checkout_url: session.checkout_url,
          session_id: session.session_id,
          session_data: session.session_data || null,
          amount_minor: orderAmountMinor(order),
        });
      }
    } catch (payErr) {
      await rollbackOrders(created);
      throw payErr;
    }

    // Compat mono-boutique : champs plats + tableau checkouts
    const primary = checkouts[0];
    const sameCurrency = checkouts.every((c) => c.currency === primary.currency);
    return json(res, 201, {
      ok: true,
      provider,
      multi,
      order_id: primary.order_id,
      // Ne jamais additionner des montants de devises différentes.
      total: sameCurrency ? Math.round(checkouts.reduce((s, c) => s + Number(c.total), 0) * 100) / 100 : null,
      currency: sameCurrency ? primary.currency : null,
      totals_by_currency: Object.fromEntries(
        [...checkouts.reduce((m, c) => {
          m.set(c.currency, Math.round(((m.get(c.currency) || 0) + Number(c.total)) * 100) / 100);
          return m;
        }, new Map())]
      ),
      checkout_url: primary.checkout_url,
      session_id: primary.session_id,
      checkouts,
    });
  } catch (e) {
    return sendError(res, e);
  }
}
