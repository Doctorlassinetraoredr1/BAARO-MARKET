# BAARO-MARKET — International

Marketplace multi-vendeurs : Vercel + Supabase + Cloudflare R2 + Stripe Connect / PayPal / Adyen.

## Architecture
- **Vercel** : React/Vite frontend + serverless API (`api/`)
- **Supabase** : Auth + PostgreSQL + RLS
- **Cloudflare R2** : médias (URLs présignées via `api/upload`)
- **Shippo** (optionnel) : tarifs transporteurs réels + étiquettes ; fallback grilles BAARO
- **Stripe Connect** (Express) : destination charges + `application_fee` (commission plateforme)
- **PayPal** / **Adyen** : sessions de paiement + webhooks idempotents
- Webhooks : Stripe, PayPal, Adyen (idempotents, vérification de montant)

## Flux d'achat
1. Le client ajoute des produits au panier (**multi-boutiques autorisé**).
2. Optionnel : devis livraison `POST /api/shipping` (poids + zone).
3. `POST /api/checkout` crée **une commande par boutique**, réserve le stock, ouvre les sessions de paiement.
4. En multi-boutiques, le frontend enchaîne les paiements après chaque confirmation.
5. Les webhooks marquent `paid` (ou restaurent le stock si `failed`/`cancelled`).

## Démarrage
1. Supabase : exécuter dans l'ordre  
   `001` → … → `007_shipping_carriers.sql` → `008_review_ai.sql`.
2. Copier `.env.example` → variables Vercel / local.
3. `npm --prefix frontend install && npm --prefix frontend run dev`
4. Déployer sur Vercel.

## API principale
| Endpoint | Rôle |
|----------|------|
| `GET /api/market?action=products\|product\|shops\|shop` | Catalogue public |
| `POST /api/market` | `createShop`, `createProduct`, `myOrders`, `shopOrders`, `connectStripe`, … |
| `POST /api/checkout` | Crée commande(s) + session Stripe/PayPal/Adyen |
| `POST /api/shipping` | Devis livraison par boutique |
| `POST /api/upload` | URL présignée R2 (PUT) |
| `POST /api/refund` | Remboursement (vendeur) |
| `POST /api/webhooks/stripe\|paypal\|adyen` | Paiements |

## Stripe Connect
- Action `connectStripe` : crée un compte Express + Account Link d'onboarding.
- Action `refreshConnectStatus` : synchronise `stripe_charges_enabled`.
- Au checkout, si la boutique a Connect actif → `transfer_data.destination` + `application_fee_amount`.

## Livraison
- Calcul : zone (domestic / regional / international) + poids (`weight_grams`) + option **express**.
- Zones régionales : UE, UEMOA (XOF), CEMAC (XAF), Maghreb, ECOWAS, Amérique du Nord, UK, GCC.
- Voisinage (ex. ML↔GN) traité en régional même hors même union monétaire.
- Franco de port domestic si sous-total ≥ 10× tarif domestic ; remise régionale si sous-total élevé.
- Adresse validée (`line1`, `city`, `country` ISO2).

## Sécurité
- `payment_events` / `payouts` / `refunds` : serveur uniquement (service_role).
- `orders` / `order_items` : écriture serveur uniquement.
- `profiles.role` : protégé (GRANT colonnes + trigger).
- Webhooks : signature + idempotence + match montant/devise.
- Checkout / upload / shipping / refund : rate-limité.

## Frontend
Design system **Tailwind CSS v4** + primitives (`ui/Button`, `Input`, `Card`, `Badge`).
Structure modulaire :
```
frontend/src/
  main.jsx          # entrée
  api.js, cart.js, auth.jsx
  components/       # Header, Toast, ProductCard
  pages/            # Home, Product, Shops, Cart, Auth, Orders, Seller
```

## Tests & CI
```bash
npm run check   # syntaxe api/ lib/
npm test        # unitaires money, validate, signatures, shipping…
npm run ci      # check + test
```

## Fonctionnalités

| Sujet | État |
|-------|------|
| Panier multi-boutiques | ✅ une commande + session par boutique |
| Stripe / PayPal / Adyen | ✅ sessions de paiement |
| Commission + Connect | ✅ |
| Inventaire (stock atomique) | ✅ |
| TVA (`tax_rate_bps`) | ✅ |
| Livraison (zone + poids) | ✅ |
| Upload R2 | ✅ |
| Espace vendeur + refunds | ✅ |
| Rollback checkout échoué | ✅ |
| Emails post-paiement | ✅ Resend |
| Modération / CGU | ✅ |
| Transporteurs réels (Shippo) + grilles fallback | ✅ |
| Recherche + filtres (prix, devise, tri) | ✅ |
| Avis & notations produits/boutiques | ✅ |
| Analyse IA des avis (sentiment, thèmes, synthèse) | ✅ |
| Litiges (disputes) | ✅ |
| Messagerie acheteur↔vendeur | ✅ (API) |
| KYC vendeur (statut) | ✅ champ `kyc_status` |

## Production checklist

| Fonctionnalité | Où |
|----------------|-----|
| Connect + CGU obligatoires | `api/market.js` |
| Multi-provider checkout | `lib/providers.js` + `api/checkout.js` |
| Devis livraison | `api/shipping.js` + `lib/shipping.js` |
| Rate limits | checkout, upload, shipping, refund |
| Cron expiration pending | `api/cron/expire-orders` toutes les 15 min |
| Migration | `001`→`007` |

### Variables
Voir `.env.example` : Stripe, PayPal, Adyen, R2, Resend, `CRON_SECRET`, `REQUIRE_STRIPE_CONNECT`.


## Analyse IA des avis
- À la publication d'un avis : sentiment, score, thèmes, toxicité, résumé (`lib/review-ai.js`).
- Synthèse produit : points forts/faibles, distribution, conseil acheteur (cache 6 h sur `products.ai_insights`).
- Provider : tout endpoint compatible OpenAI (`AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`).
- Sans clé API : heuristique locale (mots-clés + note).
- Endpoints : `GET /api/market?action=productInsights&product_id=…` ; analyse auto dans `createReview`.

## BAARO MARKET V2 — production scale
- Trust Engine for review anomaly flagging and verified purchases
- Seller analytics dashboard
- Admin KPI endpoint (`adminDashboard`)
- International language selector: FR/EN/PT/AR with RTL support
- Exchange-rate table for multi-currency expansion
- Audit event storage
- PostgreSQL trigram search and cursor pagination
