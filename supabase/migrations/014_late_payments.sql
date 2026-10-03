-- 014 — Paiements tardifs : réouverture d'une commande annulée + journal des anomalies.

-- Anomalies de paiement à traiter manuellement (remboursement, litige, etc.).
create table if not exists public.payment_anomalies (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete set null,
  provider text not null,
  kind text not null check (kind in (
    'amount_mismatch', 'late_payment_mismatch', 'late_payment_no_stock', 'paid_unknown_order'
  )),
  provider_event_id text,
  amount_minor bigint,
  currency text,
  details jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_note text
);
create index if not exists payment_anomalies_open_idx on public.payment_anomalies(created_at) where resolved_at is null;
alter table public.payment_anomalies enable row level security;
revoke all on public.payment_anomalies from anon, authenticated;

-- Un client a payé APRÈS l'annulation (cron, expiration) : on rouvre la commande si le stock
-- peut être re-réservé en entier, sinon rien n'est modifié (tout ou rien) et la fonction renvoie false.
create or replace function public.reopen_order_for_late_payment(p_order uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare o record; items jsonb;
begin
  select * into o from orders where id = p_order for update;
  if not found or o.status not in ('cancelled', 'failed') then return false; end if;

  select coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity)), '[]'::jsonb)
    into items from order_items where order_id = p_order;

  begin
    perform public.reserve_stock(items);
  exception when others then
    return false; -- stock insuffisant : le bloc est annulé, aucune réservation partielle
  end;

  update orders set status = 'pending', cancelled_at = null, updated_at = now() where id = p_order;
  return true;
end $$;

revoke all on function public.reopen_order_for_late_payment(uuid) from public, anon, authenticated;
grant execute on function public.reopen_order_for_late_payment(uuid) to service_role;
