import { adminClient } from '../api/_supabase.js';
import crypto from 'node:crypto';
import { HttpError } from './http.js';
import { UUID_RE, assertNotOwnShop } from './validate.js';
import { toMinor, CURRENCIES } from './money.js';
import { requireShippingAddress, validateShippingAddress, getShippingQuote } from './shipping.js';

/**
 * Normalise les items du panier.
 */
function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Cart is empty');
  if (items.length > 50) throw new HttpError(400, 'Too many items');
  return items.map((it) => {
    if (typeof it?.product_id !== 'string' || !UUID_RE.test(it.product_id)) {
      throw new HttpError(400, 'Invalid product_id');
    }
    const qty = Number(it.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new HttpError(400, 'Invalid quantity');
    return { product_id: it.product_id, quantity: qty };
  });
}

/**
 * Charge produits + boutiques, regroupe par boutique.
 * @returns {Promise<{ groups: Map, products: object, shops: object }>}
 */
async function loadCartContext(normalized) {
  const db = adminClient();
  const ids = [...new Set(normalized.map((i) => i.product_id))];

  const { data: products, error: pErr } = await db
    .from('products')
    .select('id,shop_id,name,price,currency,stock,track_inventory,tax_rate_bps,is_active,moderation_status,weight_grams')
    .in('id', ids);
  if (pErr) throw pErr;
  if (!products || products.length !== ids.length) throw new HttpError(400, 'Unknown product');

  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const shopIds = [...new Set(products.map((p) => p.shop_id))];

  const { data: shops, error: sErr } = await db
    .from('shops')
    .select('id,owner_id,name,slug,country,stripe_account_id,stripe_charges_enabled,platform_fee_bps,is_active,shipping_line1,shipping_line2,shipping_city,shipping_state,shipping_postal,shipping_phone')
    .in('id', shopIds);
  if (sErr) throw sErr;
  const shopById = Object.fromEntries((shops || []).map((s) => [s.id, s]));

  // Grouper items par shop
  const groups = new Map(); // shopId -> [{product_id, quantity}]
  for (const it of normalized) {
    const p = byId[it.product_id];
    if (!groups.has(p.shop_id)) groups.set(p.shop_id, []);
    groups.get(p.shop_id).push(it);
  }

  return { groups, byId, shopById, db };
}

/**
 * Construit les lignes et totaux pour une boutique.
 */
function buildLines(shopItems, byId) {
  let currency = null;
  let subtotal = 0;
  let taxTotal = 0;
  let weightGrams = 0;
  const lines = [];

  for (const it of shopItems) {
    const p = byId[it.product_id];
    if (!p.is_active || p.moderation_status !== 'approved') {
      throw new HttpError(400, `Product unavailable: ${p.name}`);
    }
    if (currency === null) currency = p.currency;
    else if (p.currency !== currency) throw new HttpError(400, 'Mixed currencies not allowed within a shop');

    if (p.track_inventory && p.stock < it.quantity) {
      throw new HttpError(409, `Insufficient stock for ${p.name}`);
    }

    const unit = Number(p.price);
    const line = Math.round(unit * it.quantity * 100) / 100;
    const taxBps = p.tax_rate_bps || 0;
    const tax = Math.round(line * taxBps) / 10000;
    subtotal += line;
    taxTotal += tax;
    weightGrams += (Number(p.weight_grams) || 0) * it.quantity;
    lines.push({
      product_id: p.id,
      product_name: p.name,
      quantity: it.quantity,
      unit_price: unit,
      tax_rate_bps: taxBps,
      tax_amount: Math.round(tax * 100) / 100,
      line_total: line,
    });
  }

  if (!CURRENCIES.has(currency)) throw new HttpError(400, 'Unsupported currency');
  return {
    currency,
    subtotal: Math.round(subtotal * 100) / 100,
    taxTotal: Math.round(taxTotal * 100) / 100,
    weightGrams,
    lines,
  };
}

/**
 * Crée UNE commande pour une boutique (stock réservé).
 */
async function createSingleOrder({ db, buyerId, shop, shopItems, byId, shippingAddress, express, checkoutGroupId }) {
  if (!shop.is_active) throw new HttpError(400, 'Shop is inactive');

  const { currency, subtotal, taxTotal, weightGrams, lines } = buildLines(shopItems, byId);

  // La livraison est TOUJOURS calculée côté serveur : aucun montant fourni par le client n'est accepté.
  const shopOrigin = shop.shipping_line1
    ? {
        name: shop.name,
        line1: shop.shipping_line1,
        line2: shop.shipping_line2,
        city: shop.shipping_city,
        state: shop.shipping_state,
        postal_code: shop.shipping_postal,
        country: shop.country,
        phone: shop.shipping_phone,
      }
    : null;
  const shippingQuote = await getShippingQuote({
    currency,
    shopCountry: shop.country,
    shopOrigin,
    destination: shippingAddress,
    weightGrams,
    subtotal,
    express: Boolean(express),
  });
  const ship = Math.max(0, Number(shippingQuote.amount) || 0);

  const platformFeeBps = shop.platform_fee_bps ?? 500;
  const platformFee = Math.round(subtotal * platformFeeBps) / 10000;
  const total = Math.round((subtotal + taxTotal + ship) * 100) / 100;

  const { error: rErr } = await db.rpc('reserve_stock', { p_items: shopItems });
  if (rErr) {
    if (String(rErr.message).includes('insufficient_stock')) throw new HttpError(409, 'Insufficient stock');
    throw rErr;
  }
  const release = () => db.rpc('release_items', { p_items: shopItems });

  const { data: order, error: oErr } = await db
    .from('orders')
    .insert({
      buyer_id: buyerId,
      checkout_group_id: checkoutGroupId,
      shop_id: shop.id,
      status: 'pending',
      currency,
      subtotal,
      tax_total: taxTotal,
      shipping_total: Math.round(ship * 100) / 100,
      shipping_carrier: shippingQuote?.carrier || null,
      shipping_service: shippingQuote?.service || shippingQuote?.method || null,
      shipping_rate_id: shippingQuote?.rate_id || null,
      platform_fee: Math.round(platformFee * 100) / 100,
      transfer_destination: shop.stripe_account_id && shop.stripe_charges_enabled ? shop.stripe_account_id : null,
      total,
      shipping_address: shippingAddress,
    })
    .select()
    .single();
  if (oErr) {
    await release();
    throw oErr;
  }

  const itemRows = lines.map((l) => ({ ...l, order_id: order.id }));
  const { error: iErr } = await db.from('order_items').insert(itemRows);
  if (iErr) {
    await db.from('orders').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', order.id);
    await release();
    throw iErr;
  }

  return { order, items: itemRows, shop, shippingQuote, release };
}

/**
 * Crée une ou plusieurs commandes (une par boutique).
 * Compatible multi-boutiques.
 */
export async function createOrdersFromItems({
  buyerId,
  items,
  shippingAddress = null,
  express = false,
}) {
  const normalized = normalizeItems(items);
  const addr = requireShippingAddress(shippingAddress);
  const { groups, byId, shopById, db } = await loadCartContext(normalized);

  for (const shopId of groups.keys()) assertNotOwnShop(buyerId, shopById[shopId]);

  const created = [];
  const releases = [];
  const checkoutGroupId = crypto.randomUUID();

  try {
    for (const [shopId, shopItems] of groups) {
      const shop = shopById[shopId];
      if (!shop) throw new HttpError(400, 'Unknown shop');
      const result = await createSingleOrder({
        db,
        buyerId,
        shop,
        shopItems,
        byId,
        shippingAddress: addr,
        express,
        checkoutGroupId,
      });
      created.push(result);
      releases.push(result.release);
    }
  } catch (e) {
    // Rollback de toutes les commandes déjà créées
    for (const c of created) {
      try {
        await db.rpc('close_pending_order', { p_order: c.order.id, p_status: 'cancelled' });
      } catch {
        /* ignore */
      }
    }
    throw e;
  }

  return { orders: created, multi: created.length > 1 };
}

/** @deprecated use createOrdersFromItems — conservé pour compat. */
export async function createOrderFromItems(opts) {
  const { orders } = await createOrdersFromItems(opts);
  if (orders.length !== 1) throw new HttpError(400, 'All items must belong to the same shop');
  return orders[0];
}

export function orderAmountMinor(order) {
  return toMinor(order.total, order.currency);
}

/**
 * Devis livraison sans créer de commande.
 */
export async function previewShipping({ items, shippingAddress, express }) {
  const normalized = normalizeItems(items);
  const addr = validateShippingAddress(shippingAddress);
  if (!addr) throw new HttpError(400, 'shipping_address required');

  const { groups, byId, shopById } = await loadCartContext(normalized);
  const quotes = [];

  for (const [shopId, shopItems] of groups) {
    const shop = shopById[shopId];
    if (!shop) throw new HttpError(400, 'Unknown shop');
    const { currency, subtotal, weightGrams } = buildLines(shopItems, byId);
    const shopOrigin = shop.shipping_line1
      ? {
          name: shop.name,
          line1: shop.shipping_line1,
          line2: shop.shipping_line2,
          city: shop.shipping_city,
          state: shop.shipping_state,
          postal_code: shop.shipping_postal,
          country: shop.country,
          phone: shop.shipping_phone,
        }
      : null;
    const q = await getShippingQuote({
      currency,
      shopCountry: shop.country,
      shopOrigin,
      destination: addr,
      weightGrams,
      subtotal,
      express: Boolean(express),
    });
    quotes.push({
      shop_id: shop.id,
      shop_name: shop.name,
      ...q,
      subtotal,
    });
  }

  const totalShipping = Math.round(quotes.reduce((s, q) => s + q.amount, 0) * 100) / 100;
  return { quotes, total_shipping: totalShipping, address: addr };
}
