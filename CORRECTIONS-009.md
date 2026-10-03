# BAARO MARKET — Corrections de production 009

Cette version corrige plusieurs points identifiés lors de l'audit technique.

## Corrections principales

- Remboursements Stripe/PayPal/Adyen : appels réels au prestataire, plus d'enregistrement local fictif.
- Remboursements concurrents : application atomique côté PostgreSQL avec verrouillage de la commande.
- Remboursements asynchrones : prise en charge du passage `pending` → `succeeded` avec le même identifiant.
- Étiquettes Shippo : claim atomique pour éviter l'achat de deux étiquettes en concurrence.
- Checkout multi-boutiques : aucune addition de montants appartenant à des devises différentes ; `totals_by_currency` est retourné.
- Avis publics : `buyer_id` n'est plus exposé.
- Avis : écritures directes navigateur retirées ; création via API serveur après vérification commande/produit.
- Conversations : vérification du lien entre `order_id`, acheteur et boutique.
- Insights IA publics : limitation de débit et absence d'appel IA lorsqu'il n'existe aucun avis.
- Upload R2 : `content-length` est inclus dans les en-têtes signés.
- Nouveaux produits : statut de modération `pending` par défaut.
- Référence de paiement provider conservée pour les opérations de remboursement.

## Migration Supabase

Appliquer `supabase/migrations/009_production_hardening.sql` après les migrations 001 à 008.

Les migrations existantes ne sont pas remplacées.

## Vérifications locales

- Tests : 36/36 OK
- Syntaxe : 38 fichiers OK

## Important avant production

Configurer les clés des prestataires de paiement et vérifier les webhooks dans les environnements test puis production. La migration SQL doit être exécutée sur le projet Supabase avant le déploiement de l'API corrigée.
