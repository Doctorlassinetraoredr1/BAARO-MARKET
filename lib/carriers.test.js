import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getShippingQuote, listCarrierStatus } from './carriers/index.js';
import { getTableRate } from './carriers/table.js';

describe('carriers', () => {
  it('table rate domestic', async () => {
    const q = await getShippingQuote({
      currency: 'EUR',
      shopCountry: 'FR',
      destination: { country: 'FR', line1: '1 rue', city: 'Paris' },
      weightGrams: 500,
      subtotal: 20,
    });
    assert.equal(q.source, 'table');
    assert.equal(q.zone, 'domestic');
    assert.ok(q.amount >= 0);
  });

  it('listCarrierStatus', async () => {
    const s = await listCarrierStatus();
    assert.equal(s.table, true);
    assert.equal(typeof s.shippo, 'boolean');
  });

  it('getTableRate sync', () => {
    const q = getTableRate({ currency: 'XOF', shopCountry: 'ML', buyerCountry: 'SN', weightGrams: 0 });
    assert.equal(q.zone, 'regional');
  });
});
