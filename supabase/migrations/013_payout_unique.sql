-- 013 — Un seul versement vendeur par commande (idempotence + auto-réparation des webhooks).
-- Ne crée l'index que s'il n'existe aucun doublon ; sinon, nettoyer d'abord :
--   select order_id, count(*) from public.payouts group by order_id having count(*) > 1;
do $$
begin
  if exists (select 1 from public.payouts group by order_id having count(*) > 1) then
    raise notice 'payouts: doublons détectés, index unique non créé. Nettoyez les doublons puis rejouez cette migration.';
  else
    create unique index if not exists payouts_order_unique on public.payouts(order_id);
  end if;
end $$;
