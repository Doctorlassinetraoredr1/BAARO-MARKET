import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNotOwnShop, needsReModeration } from './validate.js';
import { payoutAmount, paymentMatchesOrder } from './money.js';
import { sessionTtlMinutes } from './ttl.js';
import { requireShippingAddress } from './shipping.js';

test('assertNotOwnShop bloque le vendeur dans sa propre boutique', () => {
  assert.throws(() => assertNotOwnShop('u1', { owner_id: 'u1' }), (e) => e.status === 403);
  assert.doesNotThrow(() => assertNotOwnShop('u2', { owner_id: 'u1' }));
});

test('needsReModeration : champ visible modifié sur produit approuvé', () => {
  const cur = { name: 'Sac', description: 'Beau sac', image_url: 'https://x/a.jpg', moderation_status: 'approved' };
  assert.equal(needsReModeration(cur, { name: 'Sac neuf' }), true);
  assert.equal(needsReModeration(cur, { image_url: 'https://x/b.jpg' }), true);
  assert.equal(needsReModeration(cur, { description: '' }), true);
});

test('needsReModeration : pas de re-modération si rien de visible ne change', () => {
  const cur = { name: 'Sac', description: 'Beau sac', image_url: null, moderation_status: 'approved' };
  assert.equal(needsReModeration(cur, { name: ' Sac ' }), false);
  assert.equal(needsReModeration(cur, { price: 10, stock: 5, is_active: false }), false);
  assert.equal(needsReModeration({ ...cur, moderation_status: 'pending' }, { name: 'Autre' }), false);
  assert.equal(needsReModeration(cur, { image_url: '' }), false);
});

test('payoutAmount = total - commission', () => {
  assert.equal(payoutAmount({ total: '105.00', platform_fee: '5.00' }), 100);
  assert.equal(payoutAmount({ total: 19.99, platform_fee: null }), 19.99);
});

test('requireShippingAddress : adresse obligatoire', () => {
  assert.throws(() => requireShippingAddress(null), (e) => e.status === 400);
  assert.throws(() => requireShippingAddress({ line1: 'x' }), (e) => e.status === 400);
  const a = requireShippingAddress({ line1: '1 rue A', city: 'Bamako', country: 'ml' });
  assert.equal(a.country, 'ML');
});

test('paymentMatchesOrder : montant et devise exacts', () => {
  const order = { total: '105.50', subtotal: '100', currency: 'EUR' };
  assert.equal(paymentMatchesOrder(order, 10550, 'eur').ok, true);
  assert.equal(paymentMatchesOrder(order, 10000, 'EUR').ok, false);
  assert.equal(paymentMatchesOrder(order, 10550, 'USD').ok, false);
  assert.equal(paymentMatchesOrder(order, NaN, 'EUR').ok, false);
  assert.equal(paymentMatchesOrder({ total: 5000, currency: 'XOF' }, 5000, 'XOF').ok, true);
});

test('sessionTtlMinutes : plus court que le TTL des commandes, borné 30 min – 24 h', () => {
  assert.equal(sessionTtlMinutes({}), 55);
  assert.equal(sessionTtlMinutes({ ORDER_PENDING_TTL_MINUTES: '120' }), 115);
  assert.equal(sessionTtlMinutes({ ORDER_PENDING_TTL_MINUTES: '10' }), 30);
  assert.equal(sessionTtlMinutes({ ORDER_PENDING_TTL_MINUTES: '99999' }), 1440);
  assert.equal(sessionTtlMinutes({ ORDER_PENDING_TTL_MINUTES: 'abc' }), 55);
});

test('migrations 013/014 présentes', async () => {
  const fs = await import('node:fs/promises');
  const m14 = await fs.readFile(new URL('../supabase/migrations/014_late_payments.sql', import.meta.url), 'utf8');
  assert.match(m14, /reopen_order_for_late_payment/);
  assert.match(m14, /payment_anomalies/);
});
