// Usage : node --env-file=.env scripts/check-env.js [--prod]
// --prod : exige aussi le rate limit distribué (Upstash) et un CRON_SECRET non par défaut.
const required = [
  'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY',
];
const providers = {
  Stripe: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
  PayPal: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID', 'PAYPAL_BASE_URL'],
  Adyen: ['ADYEN_API_KEY', 'ADYEN_MERCHANT_ACCOUNT', 'ADYEN_HMAC_KEY'],
};

const missing = (names) => names.filter((n) => !process.env[n]);
let failed = false;

const m = missing(required);
if (m.length) { failed = true; console.error(`MANQUANT (obligatoire) : ${m.join(', ')}`); }
if (process.env.SUPABASE_SECRET_KEY && process.env.SUPABASE_SECRET_KEY === process.env.SUPABASE_PUBLISHABLE_KEY) {
  failed = true; console.error('SUPABASE_SECRET_KEY ne doit pas être égale à la clé publique.');
}
for (const [name, vars] of Object.entries(providers)) {
  const x = missing(vars);
  if (x.length) console.warn(`Avertissement ${name} : ${x.join(', ')} non défini(s)`);
}
if (process.argv.includes('--prod')) {
  const x = missing(['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'CRON_SECRET']);
  if (x.length) { failed = true; console.error(`MANQUANT (production) : ${x.join(', ')}`); }
  if (process.env.CRON_SECRET === 'change-me-long-random') {
    failed = true; console.error('CRON_SECRET a encore la valeur d\'exemple.');
  }
}
if (!failed) console.log('Variables obligatoires OK');
process.exit(failed ? 1 : 0);
