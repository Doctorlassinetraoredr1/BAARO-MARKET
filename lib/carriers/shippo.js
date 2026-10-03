/**
 * Shippo — tarifs réels multi-transporteurs (USPS, UPS, DHL, Chronopost via partenaires, etc.).
 * Docs: https://docs.goshippo.com/docs/api_concepts/api_overview/
 *
 * Variables: SHIPPO_API_TOKEN
 * Test token préfixe: shippo_test_
 */

const SHIPPO_BASE = process.env.SHIPPO_API_BASE || 'https://api.goshippo.com';

function token() {
  return process.env.SHIPPO_API_TOKEN || '';
}

export function isShippoConfigured() {
  return Boolean(token());
}

function mapAddress(addr, nameFallback = 'Sender') {
  return {
    name: addr.name || nameFallback,
    street1: addr.line1 || addr.street1,
    street2: addr.line2 || addr.street2 || '',
    city: addr.city,
    state: addr.state || addr.region || '',
    zip: addr.postal_code || addr.zip || '',
    country: String(addr.country || '').toUpperCase(),
    phone: addr.phone || '',
    email: addr.email || '',
  };
}

/**
 * Demande des tarifs Shippo pour un colis.
 * @returns {Promise<Array<object>>} liste de rates normalisés
 */
export async function getShippoRates({
  from,
  to,
  weightGrams,
  currency = 'USD',
  express = false,
}) {
  if (!isShippoConfigured()) return [];

  const mass = Math.max(50, Number(weightGrams) || 500); // min 50g
  const body = {
    address_from: mapAddress(from, 'Shop'),
    address_to: mapAddress(to, 'Customer'),
    parcels: [
      {
        length: '20',
        width: '15',
        height: '10',
        distance_unit: 'cm',
        weight: String(mass),
        mass_unit: 'g',
      },
    ],
    async: false,
  };

  const res = await fetch(`${SHIPPO_BASE}/shipments/`, {
    method: 'POST',
    headers: {
      Authorization: `ShippoToken ${token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.detail || data?.message || `Shippo HTTP ${res.status}`;
    const err = new Error(msg);
    err.code = 'SHIPPO_ERROR';
    err.status = res.status;
    throw err;
  }

  const rates = Array.isArray(data.rates) ? data.rates : [];
  const cur = String(currency || 'USD').toUpperCase();

  let mapped = rates
    .map((r) => {
      const amount = Number(r.amount);
      if (!Number.isFinite(amount)) return null;
      const days =
        r.estimated_days != null
          ? [Number(r.estimated_days), Number(r.estimated_days)]
          : [5, 12];
      const serviceName = r.servicelevel?.name || r.servicelevel?.token || 'Standard';
      const isExpress =
        /express|priority|overnight|next.?day|rapide/i.test(serviceName) ||
        /express|priority/i.test(r.provider || '');
      return {
        amount: Math.round(amount * 100) / 100,
        currency: String(r.currency || cur).toUpperCase(),
        zone: 'carrier',
        method: r.servicelevel?.token || serviceName,
        carrier: r.provider || 'Shippo',
        service: serviceName,
        estimated_days: days,
        express: isExpress,
        provider: 'shippo',
        rate_id: r.object_id,
        weight_grams: mass,
      };
    })
    .filter(Boolean);

  // Filtrer express si demandé, sinon préférer standard (moins cher)
  if (express) {
    const expressOnly = mapped.filter((r) => r.express);
    if (expressOnly.length) mapped = expressOnly;
  } else {
    // trier par prix croissant
    mapped.sort((a, b) => a.amount - b.amount);
  }

  return mapped;
}

/**
 * Achète une étiquette Shippo à partir d’un rate_id (optionnel, vendeur).
 */
export async function purchaseShippoLabel(rateId) {
  if (!isShippoConfigured()) throw new Error('Shippo not configured');
  const res = await fetch(`${SHIPPO_BASE}/transactions/`, {
    method: 'POST',
    headers: {
      Authorization: `ShippoToken ${token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ rate: rateId, label_file_type: 'PDF', async: false }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || data?.message || `Shippo label HTTP ${res.status}`);
  return {
    tracking_number: data.tracking_number,
    tracking_url: data.tracking_url_provider,
    label_url: data.label_url,
    status: data.status,
    transaction_id: data.object_id,
  };
}
