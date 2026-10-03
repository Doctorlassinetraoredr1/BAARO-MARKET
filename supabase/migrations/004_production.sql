-- 004 — Production : remboursements, acceptation CGU, index expiration.

alter table public.orders
  add column if not exists refund_reason text,
  add column if not exists last_refund_at timestamptz;

alter table public.shops
  add column if not exists cgu_accepted_at timestamptz;

-- Événements de remboursement (audit, en plus de payment_events).
create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  provider text not null,
  provider_refund_id text not null,
  amount numeric(20,2) not null check (amount > 0),
  currency char(3) not null,
  reason text,
  status text not null default 'succeeded'
    check (status in ('pending','succeeded','failed')),
  created_at timestamptz not null default now(),
  unique (provider, provider_refund_id)
);

alter table public.refunds enable row level security;
revoke all on public.refunds from anon, authenticated;

create index if not exists orders_pending_created_idx
  on public.orders (created_at)
  where status = 'pending';

create index if not exists refunds_order_idx on public.refunds(order_id);
