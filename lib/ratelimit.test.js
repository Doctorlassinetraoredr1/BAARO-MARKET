import { rateLimit } from './ratelimit.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('rateLimit allows under limit', () => {
  const key = `t-${Date.now()}-a`;
  for (let i = 0; i < 5; i++) {
    const r = rateLimit(key, { limit: 5, windowMs: 60_000 });
    assert.equal(r.ok, true);
  }
});

test('rateLimit blocks over limit', () => {
  const key = `t-${Date.now()}-b`;
  for (let i = 0; i < 3; i++) rateLimit(key, { limit: 3, windowMs: 60_000 });
  const r = rateLimit(key, { limit: 3, windowMs: 60_000 });
  assert.equal(r.ok, false);
  assert.ok(r.retryAfter >= 0);
});
