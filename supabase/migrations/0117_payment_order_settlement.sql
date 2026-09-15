begin;

-- The webhook handler calls this function so order confirmation and credit
-- granting are serialized by one database transaction. The idempotency key is
-- the order id, not the provider event id, so a repeated callback cannot grant
-- the same purchase twice.
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

  if billing_order.status not in ('pending', 'created') then
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

revoke all on function public.complete_billing_order(text, text, text, text, bigint, jsonb) from public;
grant execute on function public.complete_billing_order(text, text, text, text, bigint, jsonb) to service_role;

commit;
