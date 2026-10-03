/**
 * Création de sessions de paiement multi-providers.
 */
import { env } from '../api/_supabase.js';
import { HttpError } from './http.js';
import { toMinor, minorDigits } from './money.js';

/** Formate un montant majeur pour PayPal (string). */
function paypalAmount(value, currency) {
  const d = minorDigits(currency);
  const n = Number(value);
  if (!Number.isFinite(n)) return d === 0 ? '0' : '0.00';
  return d === 0 ? String(Math.round(n)) : n.toFixed(d);
}

function withOrderId(base, id) {
  try {
    const u = new URL(base);
    u.searchParams.set('order_id', id);
    if (u.hash && !u.hash.includes('order_id=')) {
      u.hash += (u.hash.includes('?') ? '&' : '?') + `order_id=${id}`;
    }
    return u.toString();
  } catch {
    return `${base}${base.includes('?') ? '&' : '?'}order_id=${id}`;
  }
}

export async function createStripeSession(order, shop, items) {
  const secret = env('STRIPE_SECRET_KEY');
  const success = env('PAYMENT_SUCCESS_URL');
  const cancel = env('PAYMENT_CANCEL_URL');

  const line_items = items.map((it) => ({
    quantity: it.quantity,
    price_data: {
      currency: order.currency.toLowerCase(),
      unit_amount: toMinor(it.unit_price, order.currency),
      product_data: { name: it.product_name || 'Product' },
    },
  }));

  if (Number(order.tax_total) > 0) {
    line_items.push({
      quantity: 1,
      price_data: {
        currency: order.currency.toLowerCase(),
        unit_amount: toMinor(order.tax_total, order.currency),
        product_data: { name: 'Tax' },
      },
    });
  }
  if (Number(order.shipping_total) > 0) {
    line_items.push({
      quantity: 1,
      price_data: {
        currency: order.currency.toLowerCase(),
        unit_amount: toMinor(order.shipping_total, order.currency),
        product_data: { name: 'Shipping' },
      },
    });
  }

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', withOrderId(success, order.id));
  params.set('cancel_url', withOrderId(cancel, order.id));
  params.set('client_reference_id', order.id);
  params.set('metadata[order_id]', order.id);
  params.set('metadata[shop_id]', shop.id);
  params.set('payment_intent_data[metadata][order_id]', order.id);

  line_items.forEach((li, i) => {
    params.set(`line_items[${i}][quantity]`, String(li.quantity));
    params.set(`line_items[${i}][price_data][currency]`, li.price_data.currency);
    params.set(`line_items[${i}][price_data][unit_amount]`, String(li.price_data.unit_amount));
    params.set(`line_items[${i}][price_data][product_data][name]`, li.price_data.product_data.name);
  });

  if (shop.stripe_account_id && shop.stripe_charges_enabled) {
    params.set('payment_intent_data[application_fee_amount]', String(toMinor(order.platform_fee, order.currency)));
    params.set('payment_intent_data[transfer_data][destination]', shop.stripe_account_id);
  }

  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await r.json();
  if (!r.ok) {
    console.error('[stripe] session error', data);
    throw new HttpError(502, data.error?.message || 'Stripe session failed');
  }
  return {
    provider: 'stripe',
    session_id: data.id,
    checkout_url: data.url,
    payment_intent_id: data.id,
  };
}

async function paypalAccessToken() {
  const clientId = env('PAYPAL_CLIENT_ID');
  const secret = env('PAYPAL_CLIENT_SECRET');
  const base = process.env.PAYPAL_BASE_URL || 'https://api-m.paypal.com';
  const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const r = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await r.json();
  if (!r.ok) throw new HttpError(502, data.error_description || 'PayPal auth failed');
  return { token: data.access_token, base };
}

export async function createPayPalOrder(order, shop, items) {
  const { token, base } = await paypalAccessToken();
  const success = env('PAYMENT_SUCCESS_URL');
  const cancel = env('PAYMENT_CANCEL_URL');

  const purchaseItems = items.map((it) => ({
    name: String(it.product_name || 'Product').slice(0, 127),
    quantity: String(it.quantity),
    unit_amount: {
      currency_code: order.currency,
      value: paypalAmount(it.unit_price, order.currency),
    },
  }));

  // Breakdown
  const itemTotal = paypalAmount(order.subtotal, order.currency);
  const tax = paypalAmount(order.tax_total || 0, order.currency);
  const shipping = paypalAmount(order.shipping_total || 0, order.currency);
  const total = paypalAmount(order.total, order.currency);

  const body = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: order.id,
        custom_id: order.id,
        description: `Order ${String(order.id).slice(0, 8)} — ${shop.name || 'BAARO'}`,
        amount: {
          currency_code: order.currency,
          value: total,
          breakdown: {
            item_total: { currency_code: order.currency, value: itemTotal },
            tax_total: { currency_code: order.currency, value: tax },
            shipping: { currency_code: order.currency, value: shipping },
          },
        },
        items: purchaseItems,
      },
    ],
    application_context: {
      brand_name: 'BAARO-MARKET',
      shipping_preference: order.shipping_address ? 'SET_PROVIDED_ADDRESS' : 'NO_SHIPPING',
      user_action: 'PAY_NOW',
      return_url: withOrderId(success, order.id),
      cancel_url: withOrderId(cancel, order.id),
    },
  };

  if (order.shipping_address) {
    const a = order.shipping_address;
    body.purchase_units[0].shipping = {
      name: a.name ? { full_name: a.name } : undefined,
      address: {
        address_line_1: a.line1,
        address_line_2: a.line2 || undefined,
        admin_area_2: a.city,
        admin_area_1: a.state || undefined,
        postal_code: a.postal_code || undefined,
        country_code: a.country,
      },
    };
  }

  const r = await fetch(`${base}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': order.id,
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) {
    console.error('[paypal] order error', data);
    throw new HttpError(502, data.message || data.details?.[0]?.description || 'PayPal order failed');
  }

  const approve = (data.links || []).find((l) => l.rel === 'approve');
  if (!approve?.href) throw new HttpError(502, 'PayPal approve link missing');

  return {
    provider: 'paypal',
    session_id: data.id,
    checkout_url: approve.href,
    payment_intent_id: data.id,
  };
}

/**
 * Adyen Drop-in / hosted checkout session (Checkout API).
 * Nécessite ADYEN_API_KEY, ADYEN_MERCHANT_ACCOUNT, ADYEN_CHECKOUT_BASE_URL.
 */
export async function createAdyenSession(order, shop, items) {
  const apiKey = env('ADYEN_API_KEY');
  const merchant = env('ADYEN_MERCHANT_ACCOUNT');
  const base = (process.env.ADYEN_CHECKOUT_BASE_URL || 'https://checkout-test.adyen.com').replace(/\/$/, '');
  const success = env('PAYMENT_SUCCESS_URL');
  const returnUrl = withOrderId(process.env.PAYMENT_RETURN_URL || success, order.id);

  const body = {
    merchantAccount: merchant,
    amount: {
      currency: order.currency,
      value: toMinor(order.total, order.currency),
    },
    reference: order.id,
    returnUrl,
    countryCode: order.shipping_address?.country || shop.country || 'FR',
    shopperReference: order.buyer_id,
    metadata: {
      order_id: order.id,
      shop_id: shop.id,
    },
    lineItems: items.map((it) => ({
      quantity: it.quantity,
      amountIncludingTax: toMinor(it.line_total + (it.tax_amount || 0), order.currency),
      description: it.product_name || 'Product',
      id: it.product_id,
    })),
  };

  // Session API (Drop-in)
  const r = await fetch(`${base}/v71/sessions`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) {
    console.error('[adyen] session error', data);
    throw new HttpError(502, data.message || data.errorCode || 'Adyen session failed');
  }

  // URL hébergée si disponible, sinon sessionData pour Drop-in côté client
  const checkoutUrl = data.url || null;
  return {
    provider: 'adyen',
    session_id: data.id,
    checkout_url: checkoutUrl,
    session_data: data.sessionData || null,
    payment_intent_id: data.id,
  };
}

export async function createPaymentSession(provider, order, shop, items) {
  switch (String(provider).toLowerCase()) {
    case 'stripe':
      return createStripeSession(order, shop, items);
    case 'paypal':
      return createPayPalOrder(order, shop, items);
    case 'adyen':
      return createAdyenSession(order, shop, items);
    default:
      throw new HttpError(400, `Unknown payment provider: ${provider}`);
  }
}
