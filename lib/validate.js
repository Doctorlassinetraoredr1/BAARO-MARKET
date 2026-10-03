import { HttpError } from './http.js';
import { CURRENCIES, minorDigits } from './money.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_PRICE = 100_000_000;

const bad = (msg) => new HttpError(400, msg);

function text(value, field, { min = 0, max, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`${field} is required`);
    return '';
  }
  if (typeof value !== 'string') throw bad(`${field} must be a string`);
  const v = value.trim();
  if (v.length < min || (required && v.length === 0)) throw bad(`${field} is too short`);
  if (v.length > max) throw bad(`${field} is too long (max ${max})`);
  return v;
}

function slug(value) {
  const v = text(value, 'slug', { min: 2, max: 64 });
  if (!SLUG_RE.test(v)) throw bad('slug must be lowercase letters, digits and single hyphens');
  return v;
}

function currency(value) {
  const v = String(value ?? 'USD').trim().toUpperCase();
  if (!CURRENCIES.has(v)) throw bad('Unsupported currency');
  return v;
}

function price(value, cur) {
  let n;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && /^\d+(\.\d{1,2})?$/.test(value.trim())) n = Number(value);
  else throw bad('price must be a number');
  if (!Number.isFinite(n) || n < 0 || n > MAX_PRICE) throw bad('price out of range');
  const scale = 10 ** minorDigits(cur);
  if (Math.abs(n * scale - Math.round(n * scale)) > 1e-6) {
    throw bad(`price has too many decimals for ${cur}`);
  }
  return Math.round(n * scale) / scale;
}

function imageUrl(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048) throw bad('image_url is invalid');
  let u;
  try { u = new URL(value); } catch { throw bad('image_url is invalid'); }
  if (u.protocol !== 'https:') throw bad('image_url must be https');
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (base && !value.startsWith(base.endsWith('/') ? base : `${base}/`)) {
    throw bad('image_url must point to the media bucket');
  }
  return u.toString();
}

export function validateShop(body) {
  return {
    name: text(body.name, 'name', { min: 1, max: 120 }),
    slug: slug(body.slug),
    description: text(body.description, 'description', { max: 2000, required: false }),
  };
}

export function validateProduct(body) {
  if (typeof body.shop_id !== 'string' || !UUID_RE.test(body.shop_id)) throw bad('shop_id is invalid');
  const cur = currency(body.currency);
  return {
    shop_id: body.shop_id,
    name: text(body.name, 'name', { min: 1, max: 200 }),
    slug: slug(body.slug),
    description: text(body.description, 'description', { max: 5000, required: false }),
    price: price(body.price, cur),
    currency: cur,
    image_url: imageUrl(body.image_url),
  };
}

// Échappe % _ \ pour un ILIKE sûr.
export const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

export function validateProductPatch(body, cur) {
  const patch = {};
  if (body.name !== undefined) patch.name = text(body.name, 'name', { min: 1, max: 200 });
  if (body.description !== undefined) patch.description = text(body.description, 'description', { max: 5000, required: false });
  if (body.price !== undefined) patch.price = price(body.price, cur);
  if (body.image_url !== undefined) patch.image_url = imageUrl(body.image_url);
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
  if (body.stock !== undefined) {
    const s = Number(body.stock);
    if (!Number.isInteger(s) || s < 0 || s > 1_000_000) throw bad('Invalid stock');
    patch.stock = s;
  }
  return patch;
}
