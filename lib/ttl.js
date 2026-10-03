/**
 * Durée de vie (minutes) des sessions de paiement Stripe/Adyen.
 * Un peu plus courte que le TTL des commandes pending, pour que la session expire
 * AVANT l'annulation de la commande. Stripe impose entre 30 min et 24 h.
 */
export function sessionTtlMinutes(envVars = process.env) {
  const ttl = Number(envVars.ORDER_PENDING_TTL_MINUTES || 60);
  const base = Number.isFinite(ttl) && ttl > 0 ? ttl : 60;
  return Math.min(1440, Math.max(30, base - 5));
}
