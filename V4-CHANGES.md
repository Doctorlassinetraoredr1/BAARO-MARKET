# BAARO MARKET V4

## International engine
- Country -> default currency mapping.
- Configurable FX provider with server-side fetch and rate limiting.
- Currency conversion with minor-unit rounding.
- Tax quote engine with explicit country rules and a flag for jurisdictions needing a specialized tax engine.
- Payment-method routing by country/currency, with Adyen regional rails exposed only when Adyen is configured.
- AI product translation endpoint with strict no-invention prompt.
- Admin analytics endpoint with revenue grouped by currency and trust/dispute metrics.
- Supabase tables for tax rules, payment methods and translation cache.

## Important
The tax rules are deliberately conservative. They are not legal/tax advice and must be configured per selling/buyer nexus before production. US/Canada are flagged for jurisdiction-specific engines.
Payment-method availability depends on merchant account configuration and country/currency; Adyen documents this explicitly. Stripe/PayPal/Adyen should remain the source of truth for live eligibility.
