# BAARO MARKET V2 — durcissement & scalabilité

## Ajouts

- `supabase/migrations/010_scale_trust_inventory.sql`
  - `checkout_group_id` pour relier les commandes d'un même panier multi-boutiques.
  - journal `inventory_movements` pour tracer réserve/libération/remboursement/ajustement.
  - fonctions de stock durcies avec journalisation.
  - index PostgreSQL trigram pour recherche produit/boutique.
  - champs `trust_status` / `trust_score` pour préparer le moteur de confiance des avis.
  - version du cache IA des produits.
- Pagination par curseur sur le catalogue `products` pour le tri `newest`.
- Limitation de taille de page côté API.
- Rate limiting branché correctement sur `api/market.js`.
- En-têtes de sécurité Vercel renforcés.
- Endpoint health marqué `version: 2.0.0`.
- Checkout : toutes les commandes générées par un même panier partagent un `checkout_group_id`.

## Vérifications

- 36/36 tests unitaires passent.
- 38 fichiers JavaScript passent le contrôle de syntaxe.
- Le build frontend n'a pas pu être confirmé dans cet environnement : l'installation npm a dépassé le délai disponible. Aucun message d'erreur de compilation n'a été obtenu.

## Déploiement Supabase

Appliquer les migrations dans l'ordre, jusqu'à `010_scale_trust_inventory.sql`.

Ne pas supprimer les migrations précédentes : la V2 dépend du schéma déjà construit par 001 → 009.
