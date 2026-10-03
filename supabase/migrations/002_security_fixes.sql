-- 002 — Correctifs de sécurité (idempotent : peut être rejoué sans risque).

-- 1) payment_events : RLS activée SANS aucune policy => inaccessible via la clé publique.
--    Seul le serveur (secret key / service_role, qui contourne RLS) y accède.
alter table public.payment_events enable row level security;
revoke all on public.payment_events from anon, authenticated;

-- Commandes : écrites uniquement par le serveur.
revoke insert, update, delete on public.orders from anon, authenticated;
revoke insert, update, delete on public.order_items from anon, authenticated;

-- 2) profiles : fin du "for all". L'utilisateur ne peut modifier que des colonnes whitelistées.
drop policy if exists profiles_self on public.profiles;
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;

create policy profiles_select_own on public.profiles
  for select to authenticated using (auth.uid() = id);
create policy profiles_update_own on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Pas d'INSERT/DELETE côté client (le profil est créé par le trigger handle_new_user).
revoke insert, update, delete on public.profiles from anon, authenticated;
-- UPDATE limité aux colonnes sûres : role, id, created_at ne sont PAS modifiables.
grant update (display_name, handle, country, avatar_url) on public.profiles to authenticated;

-- Ceinture + bretelles : même avec un futur GRANT trop large, un utilisateur ne peut pas changer son rôle.
create or replace function public.profiles_before_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    raise exception 'role cannot be modified by users' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists profiles_before_update on public.profiles;
create trigger profiles_before_update before update on public.profiles
  for each row execute function public.profiles_before_update();

-- 3) Validation des données en base (défense en profondeur, en plus de la validation API).
--    NOT VALID : contrôle les nouvelles lignes sans bloquer d'éventuelles anciennes données.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_currency_format') then
    alter table public.products add constraint products_currency_format check (currency ~ '^[A-Z]{3}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_slug_format') then
    alter table public.products add constraint products_slug_format
      check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 64) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_price_max') then
    alter table public.products add constraint products_price_max check (price <= 100000000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_name_length') then
    alter table public.products add constraint products_name_length check (char_length(btrim(name)) between 1 and 200) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'shops_slug_format') then
    alter table public.shops add constraint shops_slug_format
      check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 64) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'shops_name_length') then
    alter table public.shops add constraint shops_name_length check (char_length(btrim(name)) between 1 and 120) not valid;
  end if;
end $$;

create index if not exists payment_events_order_idx on public.payment_events(order_id);
