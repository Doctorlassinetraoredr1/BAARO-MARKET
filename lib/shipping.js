/**
 * Facade livraison — grilles internes + transporteurs réels (Shippo).
 */

import { HttpError } from './http.js';
import { getShippingQuote, listCarrierStatus, purchaseShippoLabel } from './carriers/index.js';
import { getTableRate, listTableMeta } from './carriers/table.js';

/**
 * Devis grilles internes (sync). Signature historique pour tests & checkout fallback.
 */
export function quoteShipping(opts) {
  return getTableRate(opts);
}

export function validateShippingAddress(addr) {
  if (addr == null) return null;
  if (typeof addr !== 'object' || Array.isArray(addr)) throw new HttpError(400, 'Invalid shipping_address');
  const line1 = String(addr.line1 || addr.address_line1 || '').trim().slice(0, 200);
  const city = String(addr.city || '').trim().slice(0, 100);
  const country = String(addr.country || '').trim().toUpperCase().slice(0, 2);
  const postal = String(addr.postal_code || addr.postal || '').trim().slice(0, 20);
  const name = String(addr.name || addr.recipient || '').trim().slice(0, 120);
  const line2 = String(addr.line2 || addr.address_line2 || '').trim().slice(0, 200);
  const state = String(addr.state || addr.region || '').trim().slice(0, 100);
  const phone = String(addr.phone || '').trim().slice(0, 40);
  if (!line1 || !city || !country || country.length !== 2) {
    throw new HttpError(400, 'shipping_address requires line1, city, country (ISO2)');
  }
  return {
    name: name || null,
    line1,
    line2: line2 || null,
    city,
    state: state || null,
    postal_code: postal || null,
    country,
    phone: phone || null,
  };
}

export function listShippingRates() {
  return { ...(listTableMeta()), carriers: listCarrierStatus() };
}

export { getShippingQuote, listCarrierStatus, purchaseShippoLabel, getTableRate };
