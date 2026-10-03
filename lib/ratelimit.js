/**
 * Rate limit simple en mémoire (par instance serverless).
 * Pour un durcissement multi-instance : Upstash Redis.
 * Fenêtre fixe : max N requêtes / windowMs par clé.
 */
const buckets = new Map();

export function rateLimit(key, { limit = 20, windowMs = 60_000 } = {}) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start >= windowMs) {
    b = { start: now, count: 0 };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > limit) {
    const retryAfter = Math.ceil((b.start + windowMs - now) / 1000);
    return { ok: false, retryAfter };
  }
  return { ok: true, remaining: limit - b.count };
}

/** Nettoyage opportuniste (évite fuite mémoire sur instances longues). */
export function rateLimitCleanup(maxAgeMs = 120_000) {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.start > maxAgeMs) buckets.delete(k);
  }
}

/**
 * Rate limit distribué via Upstash Redis (REST) si UPSTASH_REDIS_REST_URL/TOKEN sont définis,
 * sinon repli sur la version mémoire. En cas de panne Redis : repli mémoire (fail-open contrôlé).
 */
let warned = false;

/** Vrai si le rate limit distribué (Upstash) est configuré. */
export function isDistributedRateLimit() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

export async function rateLimitAsync(key, opts = {}) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    // En production, la version mémoire est par instance serverless : quasi inefficace.
    if (!warned && process.env.VERCEL_ENV === 'production') {
      warned = true;
      console.error(JSON.stringify({
        level: 'error',
        msg: 'rate_limit_not_distributed',
        hint: 'Définir UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN',
      }));
    }
    return rateLimit(key, opts);
  }
  const { limit = 20, windowMs = 60_000 } = opts;
  try {
    const k = `rl:${key}:${Math.floor(Date.now() / windowMs)}`;
    const r = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCR', k], ['PEXPIRE', k, windowMs]]),
    });
    const [{ result: count }] = await r.json();
    if (count > limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((windowMs - (Date.now() % windowMs)) / 1000)) };
    return { ok: true, remaining: limit - count };
  } catch {
    return rateLimit(key, opts);
  }
}
