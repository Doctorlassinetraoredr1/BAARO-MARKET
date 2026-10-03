import { HttpError } from './http.js';
import { CURRENCIES, toMinor, minorDigits } from './money.js';

const COUNTRY_CURRENCY = {
  ML:'XOF', SN:'XOF', CI:'XOF', BF:'XOF', BJ:'XOF', TG:'XOF', NE:'XOF', GW:'XOF',
  CM:'XAF', GA:'XAF', CG:'XAF', TD:'XAF', CF:'XAF', GQ:'XAF',
  FR:'EUR', DE:'EUR', ES:'EUR', IT:'EUR', PT:'EUR', BE:'EUR', NL:'EUR',
  GB:'GBP', US:'USD', CA:'CAD', AU:'AUD', JP:'JPY', CN:'CNY', IN:'INR',
  BR:'BRL', MX:'MXN', NG:'NGN', GH:'GHS', KE:'KES', ZA:'ZAR', MA:'MAD',
  AE:'AED', SA:'SAR', TR:'TRY', CH:'CHF', SG:'SGD', HK:'HKD', MY:'MYR', ID:'IDR',
};

export function normalizeCountry(value) {
  const c = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) throw new HttpError(400, 'Invalid country code');
  return c;
}

export function countryCurrency(country, fallback = 'EUR') {
  const c = normalizeCountry(country);
  const cur = COUNTRY_CURRENCY[c] || String(fallback).toUpperCase();
  if (!CURRENCIES.has(cur)) throw new HttpError(400, `Unsupported currency: ${cur}`);
  return cur;
}

export function supportedPaymentMethods(country, currency) {
  const c = normalizeCountry(country);
  const cur = String(currency || countryCurrency(c)).toUpperCase();
  const methods = [{ id:'card', provider:'stripe', label:'Card' }];
  if (['EUR','GBP','USD','CAD','AUD','CNY','HKD','SGD','JPY','BRL','MXN','AED','SAR'].includes(cur)) {
    methods.push({ id:'paypal', provider:'paypal', label:'PayPal' });
  }
  if (process.env.ADYEN_API_KEY) methods.push({ id:'adyen', provider:'adyen', label:'Local methods / cards' });
  // Local rails are intentionally advertised only when a merchant has configured them.
  const regional = {
    BR:[{id:'pix',provider:'adyen',label:'Pix'}],
    MY:[{id:'fpx',provider:'adyen',label:'FPX'}],
    CN:[{id:'alipay',provider:'adyen',label:'Alipay'},{id:'wechatpay',provider:'adyen',label:'WeChat Pay'}],
    SG:[{id:'paynow',provider:'adyen',label:'PayNow'}],
    PL:[{id:'blik',provider:'adyen',label:'BLIK'}],
  };
  return [...methods, ...(regional[c] || [])];
}

export async function fetchFxRates(base, quotes) {
  const b = String(base || 'EUR').toUpperCase();
  if (!CURRENCIES.has(b)) throw new HttpError(400, 'Unsupported base currency');
  const qs = (quotes || []).map(x => String(x).toUpperCase()).filter(x => CURRENCIES.has(x) && x !== b);
  if (!qs.length) return { base:b, rates:{ [b]:1 }, source:'base' };
  const api = (process.env.FX_API_URL || 'https://api.frankfurter.app').replace(/\/$/, '');
  const url = `${api}/latest?from=${encodeURIComponent(b)}&to=${encodeURIComponent(qs.join(','))}`;
  const r = await fetch(url, { headers:{Accept:'application/json'} });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data?.rates) throw new HttpError(502, 'FX provider unavailable');
  return { base:b, rates:{ [b]:1, ...data.rates }, date:data.date, source:api };
}

export function convertMoney(amount, from, to, rate) {
  const f = String(from).toUpperCase(); const t = String(to).toUpperCase();
  if (!CURRENCIES.has(f) || !CURRENCIES.has(t)) throw new HttpError(400, 'Unsupported currency');
  const n = Number(amount); const r = Number(rate);
  if (!Number.isFinite(n) || !Number.isFinite(r) || r <= 0) throw new HttpError(400, 'Invalid FX conversion');
  const rounded = Math.round(n * r * 10 ** minorDigits(t)) / 10 ** minorDigits(t);
  return { amount:rounded, currency:t, minor:toMinor(rounded,t) };
}

const TAX_RULES = {
  ML:{ standard:0, name:'Mali — configure applicable taxes before production' },
  FR:{ standard:20, name:'France VAT standard' },
  DE:{ standard:19, name:'Germany VAT standard' },
  GB:{ standard:20, name:'UK VAT standard' },
  ES:{ standard:21, name:'Spain VAT standard' },
  PT:{ standard:23, name:'Portugal VAT standard' },
  BE:{ standard:21, name:'Belgium VAT standard' },
  NL:{ standard:21, name:'Netherlands VAT standard' },
  US:{ standard:0, name:'US — sales tax requires jurisdiction-specific calculation' },
  CA:{ standard:0, name:'Canada — GST/HST/PST requires jurisdiction-specific calculation' },
};

export function taxQuote({ country, subtotal, shipping = 0, taxClass = 'standard' }) {
  const c = normalizeCountry(country); const base = Number(subtotal) + Number(shipping);
  if (!Number.isFinite(base) || base < 0) throw new HttpError(400, 'Invalid taxable amount');
  const rule = TAX_RULES[c] || { standard:0, name:'No default rule configured' };
  const rate = Number(rule[taxClass] ?? rule.standard ?? 0);
  const tax = Math.round(base * rate) / 100;
  return { country:c, tax_rate_percent:rate, taxable_amount:base, tax_amount:tax, total:base+tax, rule:rule.name, requires_external_tax_engine:['US','CA'].includes(c) };
}
