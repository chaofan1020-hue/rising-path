begin;

create unique index if not exists billing_orders_one_open_per_user_uidx
  on public.billing_orders(user_id)
  where status in ('pending', 'created');

create or replace function public.complete_billing_order(
  p_order_no text,
  p_provider text,
  p_merchant_order_no text,
  p_provider_trade_no text default null,
  p_amount_minor bigint default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  ok boolean,
  code text,
  order_id bigint,
  user_id uuid,
  credits numeric,
  balance numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  billing_order public.billing_orders%rowtype;
  attempt public.payment_attempts%rowtype;
  grant_result record;
  current_balance numeric;
begin
  if nullif(trim(coalesce(p_order_no, '')), '') is null
     or nullif(trim(coalesce(p_provider, '')), '') is null
     or nullif(trim(coalesce(p_merchant_order_no, '')), '') is null then
    return query select false, 'INVALID_PAYMENT_CONFIRMATION', null::bigint, null::uuid, 0::numeric, 0::numeric;
    return;
  end if;

  select * into billing_order
    from public.billing_orders
   where order_no = p_order_no
   for update;
  if billing_order.id is null then
    return query select false, 'ORDER_NOT_FOUND', null::bigint, null::uuid, 0::numeric, 0::numeric;
    return;
  end if;

  if p_amount_minor is null or billing_order.amount_minor is distinct from p_amount_minor then
    return query select false, 'PAYMENT_AMOUNT_MISMATCH', billing_order.id, billing_order.user_id, billing_order.credits_granted, 0::numeric;
    return;
  end if;

  select * into attempt
    from public.payment_attempts
   where order_id = billing_order.id
     and provider = p_provider
     and merchant_order_no = p_merchant_order_no
   for update;
  if attempt.id is null then
    return query select false, 'PAYMENT_ATTEMPT_NOT_FOUND', billing_order.id, billing_order.user_id, billing_order.credits_granted, 0::numeric;
    return;
  end if;

  if billing_order.status = 'paid' then
    select balance into current_balance from public.credit_accounts where user_id = billing_order.user_id;
    return query select true, 'IDEMPOTENT_REPLAY', billing_order.id, billing_order.user_id, billing_order.credits_granted, coalesce(current_balance, 0);
    return;
  end if;

  -- Delayed callbacks can arrive after a local cancel/expiry. If the channel
  -- actually captured funds, still grant credits instead of keeping the money.
  if billing_order.status not in ('pending', 'created', 'cancelled', 'expired', 'failed') then
    return query select false, 'ORDER_NOT_PAYABLE', billing_order.id, billing_order.user_id, billing_order.credits_granted, 0::numeric;
    return;
  end if;

  if billing_order.credits_granted > 0 then
    select * into grant_result from public.grant_credits(
      billing_order.user_id,
      billing_order.credits_granted,
      'purchase',
      'billing:order:' || billing_order.id::text,
      '支付购买积分',
      coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
        'order_id', billing_order.id,
        'order_no', billing_order.order_no,
        'provider', p_provider,
        'provider_trade_no', p_provider_trade_no
      )
    );
    current_balance := grant_result.balance;
  else
    select balance into current_balance from public.credit_accounts where user_id = billing_order.user_id;
  end if;

  update public.billing_orders
     set status = 'paid',
         provider = coalesce(p_provider, provider),
         provider_order_id = coalesce(p_provider_trade_no, p_merchant_order_no),
         paid_at = coalesce(paid_at, now()),
         updated_at = now()
   where id = billing_order.id;

  update public.payment_attempts
     set status = 'paid',
         provider_trade_no = coalesce(p_provider_trade_no, provider_trade_no),
         paid_at = coalesce(paid_at, now()),
         provider_payload = coalesce(provider_payload, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
         updated_at = now()
   where id = attempt.id;

  return query select true, 'PAID', billing_order.id, billing_order.user_id, billing_order.credits_granted, coalesce(current_balance, 0);
end;
$$;

create or replace function public.complete_billing_refund(
  p_order_no text,
  p_provider text,
  p_merchant_order_no text,
  p_reason text default null
)
returns table (
  ok boolean,
  code text,
  order_id bigint,
  user_id uuid,
  credits numeric,
  balance numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  billing_order public.billing_orders%rowtype;
  attempt public.payment_attempts%rowtype;
  account public.credit_accounts%rowtype;
  refund_key text;
  deduct numeric;
begin
  if nullif(trim(coalesce(p_order_no, '')), '') is null then
    return query select false, 'INVALID_REFUND_CONFIRMATION', null::bigint, null::uuid, 0::numeric, 0::numeric;
    return;
  end if;

  select * into billing_order from public.billing_orders where order_no = p_order_no for update;
  if billing_order.id is null then
    return query select false, 'ORDER_NOT_FOUND', null::bigint, null::uuid, 0::numeric, 0::numeric;
    return;
  end if;

  select * into attempt
    from public.payment_attempts
   where order_id = billing_order.id
     and (p_provider is null or provider = p_provider)
     and (p_merchant_order_no is null or merchant_order_no = p_merchant_order_no)
   order by created_at desc
   limit 1
   for update;
  if attempt.id is null then
    return query select false, 'PAYMENT_ATTEMPT_NOT_FOUND', billing_order.id, billing_order.user_id, billing_order.credits_granted, 0::numeric;
    return;
  end if;

  refund_key := 'billing:refund:order:' || billing_order.id::text;

  if billing_order.status = 'refunded' then
    select balance into account from public.credit_accounts where user_id = billing_order.user_id;
    return query select true, 'IDEMPOTENT_REPLAY', billing_order.id, billing_order.user_id, billing_order.credits_granted, coalesce(account.balance, 0);
    return;
  end if;

  if billing_order.status = 'partially_refunded' then
    update public.billing_orders
       set status = 'refunded', refunded_at = coalesce(refunded_at, now()), updated_at = now()
     where id = billing_order.id;
    update public.payment_attempts
       set status = 'refunded', refunded_at = coalesce(refunded_at, now()), updated_at = now()
     where id = attempt.id;
    select balance into account from public.credit_accounts where user_id = billing_order.user_id;
    return query select true, 'REFUNDED', billing_order.id, billing_order.user_id, billing_order.credits_granted, coalesce(account.balance, 0);
    return;
  end if;

  if billing_order.status <> 'paid' then
    return query select false, 'ORDER_NOT_REFUNDABLE', billing_order.id, billing_order.user_id, billing_order.credits_granted, 0::numeric;
    return;
  end if;

  insert into public.credit_accounts (user_id) values (billing_order.user_id)
    on conflict (user_id) do nothing;
  select * into account from public.credit_accounts where user_id = billing_order.user_id for update;
  deduct := least(coalesce(account.balance, 0), coalesce(billing_order.credits_granted, 0));

  if deduct > 0 and not exists (select 1 from public.credit_ledger where user_id = billing_order.user_id and idempotency_key = refund_key) then
    update public.credit_accounts
       set balance = balance - deduct,
           lifetime_granted = greatest(0, lifetime_granted - deduct),
           version = version + 1,
           updated_at = now()
     where id = account.id
     returning * into account;
    insert into public.credit_ledger (user_id, account_id, entry_type, delta, balance_after, idempotency_key, reason, metadata)
    values (
      billing_order.user_id,
      account.id,
      'refund',
      -deduct,
      account.balance,
      refund_key,
      coalesce(p_reason, '支付退款扣回积分'),
      jsonb_build_object('order_id', billing_order.id, 'order_no', billing_order.order_no, 'requested_credits', billing_order.credits_granted, 'deducted_credits', deduct)
    );
  else
    select * into account from public.credit_accounts where user_id = billing_order.user_id;
  end if;

  update public.billing_orders
     set status = 'refunded', refunded_at = coalesce(refunded_at, now()), updated_at = now()
   where id = billing_order.id;
  update public.payment_attempts
     set status = 'refunded', refunded_at = coalesce(refunded_at, now()), updated_at = now()
   where id = attempt.id;

  return query select true, 'REFUNDED', billing_order.id, billing_order.user_id, billing_order.credits_granted, coalesce(account.balance, 0);
end;
$$;

revoke all on function public.complete_billing_order(text, text, text, text, bigint, jsonb) from public;
revoke all on function public.complete_billing_refund(text, text, text, text) from public;
grant execute on function public.complete_billing_order(text, text, text, text, bigint, jsonb) to service_role;
grant execute on function public.complete_billing_refund(text, text, text, text) to service_role;

commit;
