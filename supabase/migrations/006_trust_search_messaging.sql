-- 006 — Confiance, recherche, messagerie, litiges, notations.

-- Ratings agrégés sur produits et boutiques
alter table public.products
  add column if not exists rating_avg numeric(3,2) not null default 0
    check (rating_avg >= 0 and rating_avg <= 5),
  add column if not exists rating_count integer not null default 0
    check (rating_count >= 0);

alter table public.shops
  add column if not exists rating_avg numeric(3,2) not null default 0
    check (rating_avg >= 0 and rating_avg <= 5),
  add column if not exists rating_count integer not null default 0
    check (rating_count >= 0),
  add column if not exists kyc_status text not null default 'none'
    check (kyc_status in ('none','pending','verified','rejected'));

-- Avis produits (acheteur ayant commandé payé)
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  rating integer not null check (rating >= 1 and rating <= 5),
  title text,
  body text,
  created_at timestamptz not null default now(),
  unique (order_id, product_id)
);

create index if not exists reviews_product_idx on public.reviews(product_id);
create index if not exists reviews_shop_idx on public.reviews(shop_id);
create index if not exists reviews_buyer_idx on public.reviews(buyer_id);

-- Messagerie acheteur ↔ vendeur (threads liés à une commande ou une boutique)
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  subject text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, buyer_id, order_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists messages_conv_idx on public.messages(conversation_id, created_at);

-- Litiges / médiation
create table if not exists public.disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  opened_by uuid not null references public.profiles(id),
  shop_id uuid not null references public.shops(id),
  reason text not null check (reason in ('not_received','not_as_described','damaged','other')),
  description text not null,
  status text not null default 'open'
    check (status in ('open','seller_responded','under_review','resolved_buyer','resolved_seller','closed')),
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id)
);

create index if not exists disputes_shop_idx on public.disputes(shop_id);
create index if not exists disputes_status_idx on public.disputes(status);

-- Recherche : index trigram si extension dispo, sinon btree classiques
create index if not exists products_name_lower_idx on public.products (lower(name));
create index if not exists products_price_idx on public.products (price);
create index if not exists products_currency_idx on public.products (currency);
create index if not exists shops_name_lower_idx on public.shops (lower(name));

-- RLS
alter table public.reviews enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.disputes enable row level security;

-- Reviews : lecture publique, écriture acheteur uniquement
create policy reviews_select on public.reviews for select using (true);
create policy reviews_insert on public.reviews for insert
  with check (auth.uid() = buyer_id);

-- Conversations : participants seulement
create policy conv_select on public.conversations for select
  using (
    auth.uid() = buyer_id
    or exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid())
  );
create policy conv_insert on public.conversations for insert
  with check (auth.uid() = buyer_id);
create policy conv_update on public.conversations for update
  using (
    auth.uid() = buyer_id
    or exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid())
  );

create policy msg_select on public.messages for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (
          c.buyer_id = auth.uid()
          or exists (select 1 from public.shops s where s.id = c.shop_id and s.owner_id = auth.uid())
        )
    )
  );
create policy msg_insert on public.messages for insert
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (
          c.buyer_id = auth.uid()
          or exists (select 1 from public.shops s where s.id = c.shop_id and s.owner_id = auth.uid())
        )
    )
  );

-- Disputes : parties + lecture propriétaire boutique
create policy disputes_select on public.disputes for select
  using (
    auth.uid() = opened_by
    or exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid())
  );
create policy disputes_insert on public.disputes for insert
  with check (auth.uid() = opened_by);

-- Recalcule les moyennes après un avis (security definer)
create or replace function public.refresh_product_rating(p_product uuid) returns void
language plpgsql security definer set search_path = public as $$
declare avg_r numeric; cnt int; sid uuid;
begin
  select coalesce(avg(rating)::numeric(3,2), 0), count(*), max(shop_id)
    into avg_r, cnt, sid from public.reviews where product_id = p_product;
  update public.products set rating_avg = coalesce(avg_r, 0), rating_count = coalesce(cnt, 0)
    where id = p_product;
  if sid is not null then
    select coalesce(avg(rating)::numeric(3,2), 0), count(*)
      into avg_r, cnt from public.reviews where shop_id = sid;
    update public.shops set rating_avg = coalesce(avg_r, 0), rating_count = coalesce(cnt, 0)
      where id = sid;
  end if;
end $$;

revoke all on function public.refresh_product_rating(uuid) from public, anon, authenticated;
grant execute on function public.refresh_product_rating(uuid) to service_role;
