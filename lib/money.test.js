import { minorDigits, toMinor, CURRENCIES, ZERO_DECIMAL } from './money.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('minorDigits', () => {
  assert.equal(minorDigits('USD'), 2);
  assert.equal(minorDigits('EUR'), 2);
  assert.equal(minorDigits('JPY'), 0);
  assert.equal(minorDigits('KRW'), 0);
});

test('toMinor', () => {
  assert.equal(toMinor(10.5, 'USD'), 1050);
  assert.equal(toMinor(10, 'JPY'), 10);
  assert.equal(toMinor('19.99', 'EUR'), 1999);
  assert.equal(toMinor(0, 'USD'), 0);
});

test('CURRENCIES contains common codes', () => {
  assert.ok(CURRENCIES.has('USD'));
  assert.ok(CURRENCIES.has('EUR'));
  assert.ok(CURRENCIES.has('XOF'));
  assert.ok(ZERO_DECIMAL.has('JPY'));
});
