-- 007 — Adresses d'expédition boutique + suivi colis transporteurs réels.

alter table public.shops
  add column if not exists shipping_line1 text,
  add column if not exists shipping_line2 text,
  add column if not exists shipping_city text,
  add column if not exists shipping_state text,
  add column if not exists shipping_postal text,
  add column if not exists shipping_phone text;

alter table public.orders
  add column if not exists shipping_carrier text,
  add column if not exists shipping_service text,
  add column if not exists shipping_rate_id text,
  add column if not exists tracking_number text,
  add column if not exists tracking_url text,
  add column if not exists label_url text;

-- Expéditions / étiquettes (audit)
create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  shop_id uuid not null references public.shops(id),
  provider text not null default 'table',
  carrier text,
  service text,
  rate_id text,
  amount numeric(20,2),
  currency char(3),
  tracking_number text,
  tracking_url text,
  label_url text,
  status text not null default 'quoted'
    check (status in ('quoted','purchased','in_transit','delivered','failed','cancelled')),
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shipments_order_idx on public.shipments(order_id);
alter table public.shipments enable row level security;
revoke all on public.shipments from anon, authenticated;
-- lecture pour buyer / owner via service role côté API uniquement
