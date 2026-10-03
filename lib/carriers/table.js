/**
 * Grilles internes (fallback) — Afrique, Europe, international.
 */

const BASE_RATES = {
  USD: { domestic: 5, regional: 12, international: 25, perKg: 3, expressMult: 1.8 },
  EUR: { domestic: 4.5, regional: 11, international: 22, perKg: 2.8, expressMult: 1.75 },
  GBP: { domestic: 4, regional: 10, international: 20, perKg: 2.5, expressMult: 1.8 },
  XOF: { domestic: 1500, regional: 3500, international: 12000, perKg: 800, expressMult: 1.6 },
  XAF: { domestic: 1500, regional: 3500, international: 12000, perKg: 800, expressMult: 1.6 },
  MAD: { domestic: 30, regional: 80, international: 180, perKg: 15, expressMult: 1.7 },
  NGN: { domestic: 2500, regional: 6000, international: 18000, perKg: 1200, expressMult: 1.6 },
  GHS: { domestic: 25, regional: 60, international: 180, perKg: 12, expressMult: 1.6 },
  CAD: { domestic: 6, regional: 14, international: 28, perKg: 3.5, expressMult: 1.8 },
  DEFAULT: { domestic: 5, regional: 12, international: 25, perKg: 3, expressMult: 1.8 },
};

const REGIONS = {
  EU: new Set(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE']),
  WAEMU: new Set(['BJ','BF','CI','GW','ML','NE','SN','TG']),
  CEMAC: new Set(['CM','CF','TD','CG','GQ','GA']),
  MAGHREB: new Set(['MA','DZ','TN','LY','MR']),
  ECOWAS: new Set(['NG','GH','LR','SL','GM','CV','GN']),
  NA: new Set(['US','CA','MX']),
  UK: new Set(['GB']),
  GCC: new Set(['AE','SA','KW','QA','BH','OM']),
};

const NEIGHBORS = {
  ML: new Set(['SN','BF','CI','GN','MR','NE','DZ']),
  SN: new Set(['ML','GM','GN','MR','CV']),
  CI: new Set(['GH','BF','ML','LR','GN']),
  BF: new Set(['ML','CI','GH','TG','BJ','NE']),
  NG: new Set(['BJ','NE','CM','TD']),
  CM: new Set(['NG','TD','CF','GA','GQ','CG']),
  FR: new Set(['BE','DE','CH','IT','ES','LU','MC','AD']),
  MA: new Set(['DZ','ES','MR']),
};

function regionOf(country) {
  const c = String(country || '').toUpperCase();
  for (const [name, set] of Object.entries(REGIONS)) {
    if (set.has(c)) return name;
  }
  return c || 'XX';
}

function ratesFor(currency) {
  return BASE_RATES[String(currency || '').toUpperCase()] || BASE_RATES.DEFAULT;
}

function areNeighbors(a, b) {
  const A = String(a || '').toUpperCase();
  const B = String(b || '').toUpperCase();
  return (NEIGHBORS[A] && NEIGHBORS[A].has(B)) || (NEIGHBORS[B] && NEIGHBORS[B].has(A));
}

/**
 * @returns {Promise<{ amount: number, currency: string, zone: string, method: string, carrier: string, service: string, estimated_days: [number,number], express: boolean, provider: 'table', rate_id?: string }>}
 */
export function getTableRate({
  currency,
  shopCountry,
  buyerCountry,
  weightGrams = 0,
  subtotal = 0,
  express = false,
}) {
  const rates = ratesFor(currency);
  const shop = String(shopCountry || '').toUpperCase() || null;
  const buyer = String(buyerCountry || '').toUpperCase() || null;

  let zone = 'international';
  let estimated_days = [10, 28];

  if (shop && buyer && shop === buyer) {
    zone = 'domestic';
    estimated_days = [2, 5];
  } else if (shop && buyer && regionOf(shop) === regionOf(buyer) && regionOf(shop) !== 'XX') {
    zone = 'regional';
    estimated_days = [4, 10];
  } else if (shop && buyer && areNeighbors(shop, buyer)) {
    zone = 'regional';
    estimated_days = [5, 12];
  }

  const base = rates[zone] ?? rates.international;
  const kg = Math.max(0, Number(weightGrams) || 0) / 1000;
  const weightFee = Math.ceil(kg * 10) / 10 * rates.perKg;
  let amount = Math.round((base + weightFee) * 100) / 100;

  if (express) {
    amount = Math.round(amount * (rates.expressMult || 1.8) * 100) / 100;
    estimated_days = [
      Math.max(1, Math.floor(estimated_days[0] / 2)),
      Math.max(2, Math.ceil(estimated_days[1] / 2)),
    ];
  }

  const freeThreshold = rates.domestic * 10;
  if (!express && Number(subtotal) >= freeThreshold && zone === 'domestic') amount = 0;

  const regionalFree = rates.regional * 15;
  if (!express && zone === 'regional' && Number(subtotal) >= regionalFree) {
    amount = Math.round(amount * 0.5 * 100) / 100;
  }

  return {
    amount,
    currency: String(currency || 'USD').toUpperCase(),
    zone,
    method: express ? `express_${zone}` : `standard_${zone}`,
    carrier: 'BAARO',
    service: express ? 'Express' : 'Standard',
    estimated_days,
    express: Boolean(express),
    provider: 'table',
    weight_grams: Math.max(0, Number(weightGrams) || 0),
  };
}

export function listTableMeta() {
  return { rates: BASE_RATES, regions: Object.keys(REGIONS) };
}
