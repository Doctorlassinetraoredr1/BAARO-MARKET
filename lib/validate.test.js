import { validateShop, validateProduct, escapeLike, UUID_RE } from './validate.js';
import { HttpError } from './http.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('validateShop ok', () => {
  const s = validateShop({ name: 'Ma Boutique', slug: 'ma-boutique', description: 'x' });
  assert.equal(s.slug, 'ma-boutique');
});

test('validateShop rejects bad slug', () => {
  assert.throws(() => validateShop({ name: 'A', slug: 'Bad Slug' }), HttpError);
});

test('validateProduct ok', () => {
  const p = validateProduct({
    shop_id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Produit',
    slug: 'produit',
    price: 12.5,
    currency: 'eur',
  });
  assert.equal(p.currency, 'EUR');
  assert.equal(p.price, 12.5);
});

test('validateProduct rejects invalid shop_id', () => {
  assert.throws(
    () => validateProduct({ shop_id: 'x', name: 'P', slug: 'p', price: 1, currency: 'USD' }),
    HttpError,
  );
});

test('escapeLike', () => {
  assert.equal(escapeLike('100%_raw'), '100\\%\\_raw');
});

test('UUID_RE', () => {
  assert.ok(UUID_RE.test('550e8400-e29b-41d4-a716-446655440000'));
  assert.ok(!UUID_RE.test('not-a-uuid'));
});

import { validateProductPatch } from './validate.js';
test('validateProductPatch valide prix et stock', () => {
  assert.deepEqual(validateProductPatch({ price: 10, stock: 3 }, 'USD'), { price: 10, stock: 3 });
  assert.throws(() => validateProductPatch({ price: -1 }, 'USD'));
  assert.throws(() => validateProductPatch({ price: 10.5 }, 'XOF'));
  assert.throws(() => validateProductPatch({ stock: 1.5 }, 'USD'));
});
