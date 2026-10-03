-- BAARO MARKET V2+: Trust Engine + admin analytics + international metadata
alter table public.reviews
  add column if not exists trust_reason text,
  add column if not exists verified_purchase boolean not null default true;
create index if not exists reviews_shop_trust_idx on public.reviews(shop_id, trust_status);

alter table public.shops
  add column if not exists default_currency char(3),
  add column if not exists default_language text not null default 'fr';

create table if not exists public.exchange_rates (
  base_currency char(3) not null,
  quote_currency char(3) not null,
  rate numeric(20,8) not null check (rate > 0),
  updated_at timestamptz not null default now(),
  primary key (base_currency, quote_currency)
);
alter table public.exchange_rates enable row level security;
drop policy if exists exchange_rates_public_read on public.exchange_rates;
create policy exchange_rates_public_read on public.exchange_rates for select using (true);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_created_idx on public.audit_events(created_at desc);
create index if not exists audit_events_entity_idx on public.audit_events(entity_type, entity_id);
alter table public.audit_events enable row level security;
revoke all on public.audit_events from anon, authenticated;
