-- BAARO MARKET V2: scalabilité, traçabilité stock et confiance.

alter table public.orders
  add column if not exists checkout_group_id uuid;

create index if not exists orders_checkout_group_idx
  on public.orders(checkout_group_id);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  quantity_delta integer not null check (quantity_delta <> 0),
  reason text not null check (reason in ('reserve','release','refund','manual','adjustment')),
  created_at timestamptz not null default now()
);
create index if not exists inventory_movements_product_created_idx
  on public.inventory_movements(product_id, created_at desc);
create index if not exists inventory_movements_order_idx
  on public.inventory_movements(order_id);

alter table public.inventory_movements enable row level security;
revoke all on public.inventory_movements from anon, authenticated;

-- Recrée les fonctions de stock en enregistrant chaque mouvement.
create or replace function public.reserve_stock(p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb; n int; pid uuid; qty int;
begin
  for it in select * from jsonb_array_elements(p_items) loop
    pid := (it->>'product_id')::uuid; qty := (it->>'quantity')::int;
    update products set stock = stock - qty
      where id = pid and track_inventory and stock >= qty;
    get diagnostics n = row_count;
    if n = 0 and exists (select 1 from products where id = pid and track_inventory) then
      raise exception 'insufficient_stock' using errcode = 'P0001';
    end if;
    if n = 1 then
      insert into inventory_movements(product_id, quantity_delta, reason)
      values(pid, -qty, 'reserve');
    end if;
  end loop;
end $$;

create or replace function public.release_items(p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb; pid uuid; qty int;
begin
  for it in select * from jsonb_array_elements(p_items) loop
    pid := (it->>'product_id')::uuid; qty := (it->>'quantity')::int;
    update products p set stock = p.stock + qty
      where p.id = pid and p.track_inventory;
    if found then
      insert into inventory_movements(product_id, quantity_delta, reason)
      values(pid, qty, 'release');
    end if;
  end loop;
end $$;

create or replace function public.close_pending_order(p_order uuid, p_status text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int; oi record;
begin
  if p_status not in ('failed','cancelled') then raise exception 'bad status'; end if;
  update orders set status = p_status, updated_at = now(),
    cancelled_at = case when p_status = 'cancelled' then now() else null end
    where id = p_order and status = 'pending';
  get diagnostics n = row_count;
  if n = 0 then return false; end if;
  for oi in select product_id, quantity from order_items where order_id = p_order loop
    update products p set stock = p.stock + oi.quantity
      where p.id = oi.product_id and p.track_inventory;
    if found then
      insert into inventory_movements(product_id, order_id, quantity_delta, reason)
      values(oi.product_id, p_order, oi.quantity, 'release');
    end if;
  end loop;
  return true;
end $$;

revoke all on function public.reserve_stock(jsonb), public.release_items(jsonb), public.close_pending_order(uuid,text)
from public, anon, authenticated;
grant execute on function public.reserve_stock(jsonb), public.release_items(jsonb), public.close_pending_order(uuid,text)
to service_role;

-- Recherche textuelle plus efficace pour le catalogue.
create extension if not exists pg_trgm;
create index if not exists products_name_trgm_idx
  on public.products using gin (name gin_trgm_ops);
create index if not exists shops_name_trgm_idx
  on public.shops using gin (name gin_trgm_ops);

-- Colonnes de confiance pour détecter les avis atypiques sans les supprimer automatiquement.
alter table public.reviews
  add column if not exists trust_status text not null default 'normal'
    check (trust_status in ('normal','review','blocked')),
  add column if not exists trust_score numeric(5,4);
create index if not exists reviews_trust_status_idx on public.reviews(trust_status);

-- Cache IA : évite de régénérer inutilement une synthèse produit.
alter table public.products
  add column if not exists ai_insights_version integer not null default 1;

-- Journalise le retour de stock lors d'un remboursement intégral, sans doubler les écritures.
create or replace function public.log_refund_inventory() returns trigger
language plpgsql security definer set search_path = public as $$
declare oi record;
begin
  if new.status = 'succeeded' and coalesce(old.status,'') <> 'succeeded' then
    if exists (select 1 from orders where id = new.order_id and status = 'refunded') then
      for oi in select product_id, quantity from order_items where order_id = new.order_id loop
        if not exists (
          select 1 from inventory_movements im
          where im.order_id = new.order_id and im.product_id = oi.product_id and im.reason = 'refund'
        ) then
          insert into inventory_movements(product_id, order_id, quantity_delta, reason)
          values(oi.product_id, new.order_id, oi.quantity, 'refund');
        end if;
      end loop;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists refunds_inventory_movement on public.refunds;
create trigger refunds_inventory_movement
after insert or update on public.refunds
for each row execute function public.log_refund_inventory();

revoke all on function public.log_refund_inventory() from public, anon, authenticated;
grant execute on function public.log_refund_inventory() to service_role;
