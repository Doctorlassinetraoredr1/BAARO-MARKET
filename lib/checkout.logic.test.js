/**
 * Tests pure-logic sur le regroupement multi-boutiques
 * (sans appels Supabase).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { quoteShipping } from './shipping.js';

describe('multi-shop shipping aggregation', () => {
  it('sums quotes from two shops', () => {
    const q1 = quoteShipping({ currency: 'EUR', shopCountry: 'FR', buyerCountry: 'FR', weightGrams: 200, subtotal: 10 });
    const q2 = quoteShipping({ currency: 'EUR', shopCountry: 'FR', buyerCountry: 'FR', weightGrams: 300, subtotal: 15 });
    const total = Math.round((q1.amount + q2.amount) * 100) / 100;
    assert.ok(total >= 0);
    assert.equal(typeof total, 'number');
  });
});
