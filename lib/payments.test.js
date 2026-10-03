import test from 'node:test';
import assert from 'node:assert/strict';

test('refund hardening migration exists', async () => {
  const fs = await import('node:fs/promises');
  const sql = await fs.readFile(new URL('../supabase/migrations/009_production_hardening.sql', import.meta.url), 'utf8');
  assert.match(sql, /create or replace function public\.apply_refund/);
  assert.match(sql, /for update/);
  assert.match(sql, /label_purchase_started_at/);
});
