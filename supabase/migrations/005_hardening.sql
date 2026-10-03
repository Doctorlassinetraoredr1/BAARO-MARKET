-- 005 — Durcissement : écritures serveur uniquement, colonnes publiques, stock atomique.

-- 1) shops / products : plus aucune écriture directe depuis le navigateur (tout passe par /api, service_role).
revoke insert, update, delete on public.shops from anon, authenticated;
revoke insert, update, delete on public.products from anon, authenticated;
drop policy if exists shops_owner_write on public.shops;
drop policy if exists products_owner_write on public.products;
create policy shops_owner_read on public.shops for select to authenticated using (auth.uid() = owner_id);
create policy products_owner_read on public.products for select to authenticated
  using (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid()));

-- 2) Colonnes publiques de shops : stripe_account_id, commission, etc. ne sont plus lisibles via la clé publique.
revoke select on public.shops from anon, authenticated;
grant select (id, owner_id, name, slug, description, is_active, country, created_at) on public.shops to anon, authenticated;

-- 3) Colonnes de suivi paiement.
alter table public.orders
  add column if not exists transfer_destination text,
  add column if not exists stripe_payment_intent text;
create index if not exists orders_pi_idx on public.orders(stripe_payment_intent);

-- 4) Stock atomique (une transaction, tout ou rien).
create or replace function public.reserve_stock(p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb; n int;
begin
  for it in select * from jsonb_array_elements(p_items) loop
    update products set stock = stock - (it->>'quantity')::int
      where id = (it->>'product_id')::uuid and track_inventory and stock >= (it->>'quantity')::int;
    get diagnostics n = row_count;
    if n = 0 and exists (select 1 from products where id = (it->>'product_id')::uuid and track_inventory) then
      raise exception 'insufficient_stock' using errcode = 'P0001';
    end if;
  end loop;
end $$;

create or replace function public.release_items(p_items jsonb) returns void
language sql security definer set search_path = public as $$
  update products p set stock = p.stock + (x->>'quantity')::int
  from jsonb_array_elements(p_items) x
  where p.id = (x->>'product_id')::uuid and p.track_inventory;
$$;

-- Passe une commande pending à failed/cancelled ET restaure le stock, atomiquement.
create or replace function public.close_pending_order(p_order uuid, p_status text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_status not in ('failed','cancelled') then raise exception 'bad status'; end if;
  update orders set status = p_status, updated_at = now(),
    cancelled_at = case when p_status = 'cancelled' then now() else null end
    where id = p_order and status = 'pending';
  get diagnostics n = row_count;
  if n = 0 then return false; end if;
  update products p set stock = p.stock + oi.quantity
    from order_items oi where oi.order_id = p_order and oi.product_id = p.id and p.track_inventory;
  return true;
end $$;

revoke all on function public.reserve_stock(jsonb), public.release_items(jsonb), public.close_pending_order(uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_stock(jsonb), public.release_items(jsonb), public.close_pending_order(uuid, text) to service_role;
