-- 003 — Marketplace : inventaire, panier/commandes enrichies, commissions, Stripe Connect, livraisons.

-- Shops : compte Connect + commission plateforme (bps = basis points, 500 = 5 %).
alter table public.shops
  add column if not exists stripe_account_id text,
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists platform_fee_bps integer not null default 500
    check (platform_fee_bps >= 0 and platform_fee_bps <= 5000),
  add column if not exists country char(2);

-- Products : stock + TVA indicative (taux en bps, ex. 2000 = 20 %).
alter table public.products
  add column if not exists stock integer not null default 0 check (stock >= 0),
  add column if not exists track_inventory boolean not null default true,
  add column if not exists tax_rate_bps integer not null default 0
    check (tax_rate_bps >= 0 and tax_rate_bps <= 3000),
  add column if not exists weight_grams integer check (weight_grams is null or weight_grams >= 0);

-- Orders : totaux, livraison, provider, remboursement.
alter table public.orders
  add column if not exists tax_total numeric(20,2) not null default 0,
  add column if not exists shipping_total numeric(20,2) not null default 0,
  add column if not exists platform_fee numeric(20,2) not null default 0,
  add column if not exists total numeric(20,2),
  add column if not exists payment_provider text,
  add column if not exists payment_intent_id text,
  add column if not exists shipping_address jsonb,
  add column if not exists refunded_amount numeric(20,2) not null default 0,
  add column if not exists paid_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- Renseigner total pour les lignes existantes.
update public.orders set total = subtotal where total is null;
alter table public.orders alter column total set not null;

-- Statuts autorisés.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_status_check') then
    alter table public.orders add constraint orders_status_check
      check (status in ('pending','paid','failed','cancelled','refunded','partially_refunded'));
  end if;
end $$;

-- order_items : snapshot nom/TVA + shop pour multi-vendeur futur.
alter table public.order_items
  add column if not exists product_name text,
  add column if not exists tax_rate_bps integer not null default 0,
  add column if not exists tax_amount numeric(20,2) not null default 0,
  add column if not exists line_total numeric(20,2);

update public.order_items set line_total = quantity * unit_price where line_total is null;
alter table public.order_items alter column line_total set not null;

-- Paniers côté serveur (optionnel ; le front peut aussi envoyer les items au checkout).
create table if not exists public.carts (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (buyer_id)
);

create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  unique (cart_id, product_id)
);

-- Versements / transferts vers vendeurs (audit).
create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  shop_id uuid not null references public.shops(id),
  provider text not null,
  provider_transfer_id text,
  amount numeric(20,2) not null,
  currency char(3) not null,
  status text not null default 'pending'
    check (status in ('pending','paid','failed')),
  created_at timestamptz not null default now()
);

-- Modération basique des produits.
alter table public.products
  add column if not exists moderation_status text not null default 'approved'
    check (moderation_status in ('pending','approved','rejected'));

-- RLS carts
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.payouts enable row level security;

revoke all on public.payouts from anon, authenticated;

create policy carts_owner on public.carts for all
  using (auth.uid() = buyer_id) with check (auth.uid() = buyer_id);

create policy cart_items_owner on public.cart_items for all
  using (exists (select 1 from public.carts c where c.id = cart_id and c.buyer_id = auth.uid()))
  with check (exists (select 1 from public.carts c where c.id = cart_id and c.buyer_id = auth.uid()));

-- Index utiles
create index if not exists orders_buyer_idx on public.orders(buyer_id);
create index if not exists orders_shop_idx on public.orders(shop_id);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists products_shop_idx on public.products(shop_id);
create index if not exists shops_owner_idx on public.shops(owner_id);
