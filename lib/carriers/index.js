/**
 * Routeur transporteurs.
 * Priorité : Shippo (si configuré + adresse expéditeur boutique) → grilles internes.
 */

import { getTableRate, listTableMeta } from './table.js';
import { getShippoRates, isShippoConfigured, purchaseShippoLabel } from './shippo.js';

export { isShippoConfigured, purchaseShippoLabel, listTableMeta };

/**
 * Obtient le meilleur tarif pour une boutique.
 * @param {object} opts
 * @param {object|null} opts.shopOrigin - { line1, city, country, postal_code, name, state }
 * @param {object} opts.destination - adresse acheteur validée
 * @param {string} opts.currency
 * @param {string|null} opts.shopCountry
 * @param {number} opts.weightGrams
 * @param {number} opts.subtotal
 * @param {boolean} opts.express
 * @param {string} [opts.preferredRateId] - rate Shippo choisi par l'utilisateur
 */
export async function getShippingQuote(opts) {
  const {
    shopOrigin,
    destination,
    currency,
    shopCountry,
    weightGrams = 0,
    subtotal = 0,
    express = false,
    preferredRateId = null,
  } = opts;

  const buyerCountry = destination?.country || null;
  const originCountry = shopOrigin?.country || shopCountry || null;

  // 1) Shippo si token + adresse d'expédition complète
  if (
    isShippoConfigured() &&
    shopOrigin?.line1 &&
    shopOrigin?.city &&
    shopOrigin?.country &&
    destination?.line1 &&
    destination?.city &&
    destination?.country
  ) {
    try {
      const rates = await getShippoRates({
        from: shopOrigin,
        to: destination,
        weightGrams,
        currency,
        express,
      });
      if (rates.length) {
        let chosen = rates[0];
        if (preferredRateId) {
          const match = rates.find((r) => r.rate_id === preferredRateId);
          if (match) chosen = match;
        }
        return {
          ...chosen,
          alternatives: rates.slice(0, 5),
          source: 'shippo',
        };
      }
    } catch (e) {
      console.error('[carriers] Shippo fallback to table:', e?.message || e);
    }
  }

  // 2) Grilles internes
  const table = getTableRate({
    currency,
    shopCountry: originCountry,
    buyerCountry,
    weightGrams,
    subtotal,
    express,
  });
  return { ...table, alternatives: [table], source: 'table' };
}

export async function listCarrierStatus() {
  return {
    shippo: isShippoConfigured(),
    table: true,
    meta: listTableMeta(),
  };
}
