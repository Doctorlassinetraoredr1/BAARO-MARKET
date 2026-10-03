// Devises acceptées. Les devises à 3 décimales (KWD, BHD, OMR...) sont exclues
// volontairement : la colonne SQL est numeric(20,2).
export const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'XOF', 'XAF']);

export const CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'JPY', 'KRW', 'VND', 'XOF', 'XAF',
  'CNY', 'HKD', 'SGD', 'INR', 'IDR', 'MYR', 'PHP', 'THB', 'SEK', 'NOK', 'DKK', 'PLN',
  'CZK', 'HUF', 'RON', 'TRY', 'ILS', 'AED', 'SAR', 'EGP', 'MAD', 'ZAR', 'NGN', 'GHS',
  'KES', 'TZS', 'BRL', 'MXN', 'ARS', 'COP',
]);

export const minorDigits = (currency) => (ZERO_DECIMAL.has(currency) ? 0 : 2);

// Montant en unités majeures -> unités mineures (centimes), entier.
export const toMinor = (amount, currency) =>
  Math.round(Number(amount) * 10 ** minorDigits(currency));

/** Montant dû au vendeur = total payé - commission plateforme (2 décimales). */
export function payoutAmount(order) {
  return Math.round((Number(order.total) - Number(order.platform_fee || 0)) * 100) / 100;
}

/** Le paiement reçu correspond-il à la commande (montant en unités mineures ET devise) ? */
export function paymentMatchesOrder(order, amountMinor, currency) {
  const expected = order.total != null ? toMinor(order.total, order.currency) : toMinor(order.subtotal, order.currency);
  const amountOk = Number.isFinite(amountMinor) && amountMinor === expected;
  const currencyOk = String(currency).toUpperCase() === String(order.currency).trim().toUpperCase();
  return { ok: amountOk && currencyOk, expected };
}
