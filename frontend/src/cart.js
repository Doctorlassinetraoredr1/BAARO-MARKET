const CART_KEY = 'baaro_cart';

export function loadCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
}

/** Ajoute un produit ; multi-boutiques autorisé. */
export function addToCart(cart, product) {
  const next = [...cart];
  const existing = next.find((i) => i.product_id === product.id);
  if (existing) {
    existing.quantity = Math.min(99, existing.quantity + 1);
  } else {
    next.push({
      product_id: product.id,
      name: product.name,
      price: product.price,
      currency: product.currency,
      shop_id: product.shop_id,
      tax_rate_bps: product.tax_rate_bps || 0,
      weight_grams: product.weight_grams || 0,
      quantity: 1,
    });
  }
  return next;
}

export function cartTotals(cart) {
  const byCurrency = {};
  for (const i of cart) {
    const cur = i.currency || 'USD';
    if (!byCurrency[cur]) byCurrency[cur] = { subtotal: 0, tax: 0 };
    const line = Number(i.price) * i.quantity;
    const bps = Number(i.tax_rate_bps) || 0;
    byCurrency[cur].subtotal += line;
    byCurrency[cur].tax += Math.round(line * bps) / 10000;
  }
  for (const cur of Object.keys(byCurrency)) {
    byCurrency[cur].subtotal = Math.round(byCurrency[cur].subtotal * 100) / 100;
    byCurrency[cur].tax = Math.round(byCurrency[cur].tax * 100) / 100;
    byCurrency[cur].total = Math.round((byCurrency[cur].subtotal + byCurrency[cur].tax) * 100) / 100;
  }
  return byCurrency;
}

export function shopCount(cart) {
  return new Set(cart.map((i) => i.shop_id)).size;
}
