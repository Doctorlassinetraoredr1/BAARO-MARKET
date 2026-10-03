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
