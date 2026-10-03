import { verifyStripe, adyenSignedString, verifyAdyen } from './signatures.js';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('verifyStripe accepts valid signature', () => {
  const secret = 'whsec_test';
  const body = Buffer.from('{"id":"evt_1"}');
  const t = Math.floor(Date.now() / 1000);
  const expected = createHmac('sha256', secret).update(`${t}.`).update(body).digest('hex');
  const header = `t=${t},v1=${expected}`;
  assert.equal(verifyStripe(body, header, secret), true);
});

test('verifyStripe rejects bad signature', () => {
  const body = Buffer.from('{}');
  assert.equal(verifyStripe(body, 't=1,v1=deadbeef', 'secret'), false);
});

test('verifyStripe rejects expired timestamp', () => {
  const secret = 'whsec_test';
  const body = Buffer.from('{}');
  const t = Math.floor(Date.now() / 1000) - 10_000;
  const expected = createHmac('sha256', secret).update(`${t}.`).update(body).digest('hex');
  assert.equal(verifyStripe(body, `t=${t},v1=${expected}`, secret), false);
});

test('adyenSignedString and verifyAdyen', () => {
  const item = {
    pspReference: 'PSP',
    originalReference: '',
    merchantAccountCode: 'MA',
    merchantReference: 'order-1',
    amount: { value: 1000, currency: 'EUR' },
    eventCode: 'AUTHORISATION',
    success: 'true',
  };
  const keyHex = 'AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899';
  const signed = adyenSignedString(item);
  const sig = createHmac('sha256', Buffer.from(keyHex, 'hex')).update(signed).digest('base64');
  item.additionalData = { hmacSignature: sig };
  assert.equal(verifyAdyen(item, keyHex), true);
  item.additionalData.hmacSignature = 'bad';
  assert.equal(verifyAdyen(item, keyHex), false);
});
