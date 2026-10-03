-- 009 — Durcissement production : remboursements atomiques, idempotence livraison,
-- références de paiement provider et modération réelle.

alter table public.orders
  add column if not exists payment_provider_reference text,
  add column if not exists label_purchase_started_at timestamptz;

create index if not exists orders_payment_provider_ref_idx
  on public.orders(payment_provider, payment_provider_reference);

-- Les nouvelles annonces ne sont plus automatiquement approuvées.
alter table public.products
  alter column moderation_status set default 'pending';

-- Les avis sont créés exclusivement via l'API serveur, qui vérifie achat + paiement.
revoke insert, update, delete on public.reviews from anon, authenticated;

-- Remboursement transactionnel : verrouille la commande, crée le refund et met à jour
-- le montant remboursé dans la même transaction. Le stock n'est restauré qu'une seule fois.
create or replace function public.apply_refund(
  p_order uuid,
  p_provider text,
  p_refund_id text,
  p_amount numeric,
  p_currency text,
  p_reason text,
  p_status text default 'succeeded',
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o record;
  existing_id uuid;
  already numeric(20,2);
  new_refunded numeric(20,2);
  new_status text;
begin
  if p_status not in ('pending','succeeded','failed') then
    raise exception 'bad refund status';
  end if;

  select * into o from public.orders where id = p_order for update;
  if not found then return jsonb_build_object('status','no_order'); end if;

  select id into existing_id
    from public.refunds
    where provider = p_provider and provider_refund_id = p_refund_id;

  -- Les providers asynchrones peuvent d'abord répondre pending puis confirmer
  -- le même remboursement avec le même identifiant.
  if existing_id is not null then
    if p_status = 'succeeded' then
      update public.refunds
        set status = 'succeeded', reason = coalesce(p_reason, reason)
        where id = existing_id and status = 'pending';
      if found then
        -- Continuer l'application comptable ci-dessous avec le montant déjà enregistré.
        select amount into p_amount from public.refunds where id = existing_id;
      else
        return jsonb_build_object('status','duplicate');
      end if;
    else
      return jsonb_build_object('status','duplicate');
    end if;
  end if;

  if p_status = 'pending' then
    insert into public.refunds(order_id,provider,provider_refund_id,amount,currency,reason,status)
    values(o.id,p_provider,p_refund_id,p_amount,upper(p_currency),p_reason,'pending');
    return jsonb_build_object('status','pending','refunded_amount',coalesce(o.refunded_amount,0));
  end if;

  if p_status = 'failed' then
    insert into public.refunds(order_id,provider,provider_refund_id,amount,currency,reason,status)
    values(o.id,p_provider,p_refund_id,p_amount,upper(p_currency),p_reason,'failed');
    return jsonb_build_object('status','failed','refunded_amount',coalesce(o.refunded_amount,0));
  end if;

  if o.status not in ('paid','partially_refunded') then
    return jsonb_build_object('status','invalid_status','current',o.status);
  end if;
  if upper(p_currency) <> upper(o.currency) then
    return jsonb_build_object('status','currency_mismatch');
  end if;
  if p_amount <= 0 then return jsonb_build_object('status','bad_amount'); end if;

  already := coalesce(o.refunded_amount,0);
  new_refunded := round((already + p_amount)::numeric, 2);
  if new_refunded > round(o.total + 0.001, 2) then
    return jsonb_build_object('status','refund_exceeds_total','remaining',round(o.total-already,2));
  end if;

  new_status := case when new_refunded >= o.total - 0.001 then 'refunded' else 'partially_refunded' end;

  if existing_id is null then
    insert into public.refunds(order_id,provider,provider_refund_id,amount,currency,reason,status)
    values(o.id,p_provider,p_refund_id,p_amount,upper(p_currency),p_reason,'succeeded');
  end if;

  update public.orders
    set refunded_amount = new_refunded,
        status = new_status,
        refund_reason = p_reason,
        last_refund_at = now(),
        updated_at = now()
    where id = o.id;

  if new_status = 'refunded' then
    update public.products p
      set stock = p.stock + oi.quantity
      from public.order_items oi
      where oi.order_id = o.id and oi.product_id = p.id and p.track_inventory;
  end if;

  insert into public.payment_events(order_id,provider,provider_event_id,payload)
  values(o.id,p_provider,p_provider || ':refund:' || p_refund_id,coalesce(p_payload,jsonb_build_object('refundId',p_refund_id)))
  on conflict (provider_event_id) do nothing;

  return jsonb_build_object('status',new_status,'refunded_amount',new_refunded);
exception when unique_violation then
  return jsonb_build_object('status','duplicate');
end $$;

revoke all on function public.apply_refund(uuid,text,text,numeric,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.apply_refund(uuid,text,text,numeric,text,text,text,jsonb) to service_role;
