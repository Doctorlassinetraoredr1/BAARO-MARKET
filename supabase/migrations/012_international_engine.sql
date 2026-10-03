-- BAARO MARKET V4: international engine configuration
create table if not exists public.tax_rules (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null,
  tax_class text not null default 'standard',
  rate_bps integer not null check(rate_bps between 0 and 5000),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique(country_code,tax_class)
);
alter table public.tax_rules enable row level security;
drop policy if exists tax_rules_public_read on public.tax_rules;
create policy tax_rules_public_read on public.tax_rules for select using (active=true);

create table if not exists public.payment_method_configs (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null,
  currency char(3) not null,
  provider text not null,
  method_code text not null,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  unique(country_code,currency,provider,method_code)
);
alter table public.payment_method_configs enable row level security;
drop policy if exists payment_method_configs_public_read on public.payment_method_configs;
create policy payment_method_configs_public_read on public.payment_method_configs for select using (enabled=true);

create table if not exists public.translation_cache (
  id uuid primary key default gen_random_uuid(),
  source_hash text not null,
  source_language text,
  target_language text not null,
  source_text text not null,
  translated_text text not null,
  model text,
  created_at timestamptz not null default now(),
  unique(source_hash,target_language)
);
alter table public.translation_cache enable row level security;
revoke all on public.translation_cache from anon, authenticated;

create index if not exists tax_rules_country_idx on public.tax_rules(country_code,active);
create index if not exists payment_method_country_idx on public.payment_method_configs(country_code,currency,enabled);
