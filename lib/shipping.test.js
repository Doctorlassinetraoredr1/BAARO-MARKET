import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { quoteShipping, validateShippingAddress } from './shipping.js';

describe('quoteShipping', () => {
  it('domestic FR', () => {
    const q = quoteShipping({
      currency: 'EUR',
      shopCountry: 'FR',
      buyerCountry: 'FR',
      weightGrams: 500,
      subtotal: 20,
    });
    assert.equal(q.zone, 'domestic');
    assert.ok(q.amount >= 0);
    assert.equal(q.currency, 'EUR');
  });

  it('regional EU', () => {
    const q = quoteShipping({
      currency: 'EUR',
      shopCountry: 'FR',
      buyerCountry: 'DE',
      weightGrams: 0,
    });
    assert.equal(q.zone, 'regional');
    assert.ok(q.amount > 0);
  });

  it('international', () => {
    const q = quoteShipping({
      currency: 'USD',
      shopCountry: 'US',
      buyerCountry: 'JP',
      weightGrams: 1000,
    });
    assert.equal(q.zone, 'international');
    assert.ok(q.amount > 10);
  });

  it('free domestic above threshold', () => {
    const q = quoteShipping({
      currency: 'EUR',
      shopCountry: 'FR',
      buyerCountry: 'FR',
      weightGrams: 100,
      subtotal: 1000,
    });
    assert.equal(q.amount, 0);
  });

  it('XOF West Africa', () => {
    const q = quoteShipping({
      currency: 'XOF',
      shopCountry: 'ML',
      buyerCountry: 'SN',
      weightGrams: 200,
    });
    assert.equal(q.zone, 'regional');
    assert.ok(q.amount >= 3500);
  });

  it('neighbors treated as regional', () => {
    const q = quoteShipping({
      currency: 'XOF',
      shopCountry: 'ML',
      buyerCountry: 'GN',
      weightGrams: 0,
    });
    assert.equal(q.zone, 'regional');
  });

  it('express increases amount and reduces days', () => {
    const std = quoteShipping({
      currency: 'EUR',
      shopCountry: 'FR',
      buyerCountry: 'FR',
      weightGrams: 500,
      subtotal: 10,
    });
    const exp = quoteShipping({
      currency: 'EUR',
      shopCountry: 'FR',
      buyerCountry: 'FR',
      weightGrams: 500,
      subtotal: 10,
      express: true,
    });
    assert.ok(exp.amount > std.amount);
    assert.ok(exp.estimated_days[1] <= std.estimated_days[1]);
    assert.equal(exp.express, true);
  });
});

describe('validateShippingAddress', () => {
  it('accepts valid address', () => {
    const a = validateShippingAddress({
      line1: '12 rue Example',
      city: 'Bamako',
      country: 'ml',
      name: 'Awa',
    });
    assert.equal(a.country, 'ML');
    assert.equal(a.line1, '12 rue Example');
  });

  it('rejects missing country', () => {
    assert.throws(() => validateShippingAddress({ line1: 'x', city: 'y' }), /country/);
  });

  it('null stays null', () => {
    assert.equal(validateShippingAddress(null), null);
  });
});
