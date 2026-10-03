import { createHmac, timingSafeEqual } from 'node:crypto';

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Stripe : en-tête "t=...,v1=...". HMAC-SHA256 de `${t}.${corps brut}`.
export function verifyStripe(rawBody, header, secret, toleranceSec = 300, now = Date.now()) {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length) return false;
  if (Math.abs(now / 1000 - Number(t)) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
  return sigs.some((s) => safeEqual(s, expected));
}

// Adyen : HMAC-SHA256 (clé hex) sur les champs de la notification, en base64.
const esc = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/:/g, '\\:');

export function adyenSignedString(i) {
  return [
    i.pspReference, i.originalReference, i.merchantAccountCode, i.merchantReference,
    i.amount?.value, i.amount?.currency, i.eventCode, i.success,
  ].map(esc).join(':');
}

export function verifyAdyen(item, hmacKeyHex) {
  const received = item?.additionalData?.hmacSignature;
  if (!received) return false;
  const expected = createHmac('sha256', Buffer.from(hmacKeyHex, 'hex'))
    .update(adyenSignedString(item))
    .digest('base64');
  return safeEqual(received, expected);
}
