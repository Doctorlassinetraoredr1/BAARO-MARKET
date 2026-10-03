-- 008 — Analyse IA des avis (sentiment, thèmes, toxicité, synthèse produit).

alter table public.reviews
  add column if not exists sentiment text
    check (sentiment is null or sentiment in ('positive','neutral','negative','mixed')),
  add column if not exists sentiment_score numeric(4,3),
  add column if not exists themes text[] default '{}',
  add column if not exists language text,
  add column if not exists toxicity text not null default 'none'
    check (toxicity in ('none','low','high')),
  add column if not exists ai_summary text,
  add column if not exists ai_provider text,
  add column if not exists ai_analyzed_at timestamptz;

create index if not exists reviews_sentiment_idx on public.reviews(product_id, sentiment);
create index if not exists reviews_toxicity_idx on public.reviews(toxicity) where toxicity = 'high';

-- Cache synthèse produit
alter table public.products
  add column if not exists ai_insights jsonb,
  add column if not exists ai_insights_at timestamptz;
