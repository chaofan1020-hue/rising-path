begin;

-- Root cause of "paid but still pending / credits never granted":
--
-- `returns table (ok boolean, code text, order_id bigint, user_id uuid, ...)`
-- makes order_id / user_id / credits / balance visible inside the PL/pgSQL body
-- as variable names. The function then wrote `where order_id = ...` and
-- `where user_id = ...` without aliasing the tables, so PostgreSQL raised
--   column reference "order_id" is ambiguous
-- on every single settlement. The RPC threw, settleBillingEvent marked the
-- webhook event as failed, and no credits were ever granted.
--
-- Fix: qualify every column with its table alias, and rename the OUT
-- parameters so they can never shadow a real column again.
--
-- Also allow settling an order that was locally expired/cancelled but was
-- actually paid at the channel (delayed callback), which the previous version
-- rejected with ORDER_NOT_PAYABLE.

drop function if exists public.complete_billing_order(text, text, text, text, bigint, jsonb);

create function public.complete_billing_order(
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
  r_order_id bigint,
  r_user_id uuid,
  r_credits numeric,
  r_balance numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.billing_orders%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_grant record;
  v_balance numeric;
begin
  if nullif(trim(coalesce(p_order_no, '')), '') is null
     or nullif(trim(coalesce(p_provider, '')), '') is null
     or nullif(trim(coalesce(p_merchant_order_no, '')), '') is null then
    return query select false, 'INVALID_PAYMENT_CONFIRMATION', null::bigint, null::uuid, 0::numeric, 0::numeric;
    return;
  end if;

  select o.* into v_order
    from public.billing_orders o
   where o.order_no = p_order_no
   for update;
  if v_order.id is null then
    return query select false, 'ORDER_NOT_FOUND', null::bigint, null::uuid, 0::numeric, 0::numeric;
    return;
  end if;

  if p_amount_minor is null or v_order.amount_minor is distinct from p_amount_minor then
    return query select false, 'PAYMENT_AMOUNT_MISMATCH', v_order.id, v_order.user_id, v_order.credits_granted, 0::numeric;
    return;
  end if;

  select a.* into v_attempt
    from public.payment_attempts a
   where a.order_id = v_order.id
     and a.provider = p_provider
     and a.merchant_order_no = p_merchant_order_no
   for update;
  if v_attempt.id is null then
    return query select false, 'PAYMENT_ATTEMPT_NOT_FOUND', v_order.id, v_order.user_id, v_order.credits_granted, 0::numeric;
    return;
  end if;

  if v_order.status = 'paid' then
    select c.balance into v_balance from public.credit_accounts c where c.user_id = v_order.user_id;
    return query select true, 'IDEMPOTENT_REPLAY', v_order.id, v_order.user_id, v_order.credits_granted, coalesce(v_balance, 0);
    return;
  end if;

  if v_order.status in ('refunded', 'partially_refunded') then
    return query select false, 'ORDER_ALREADY_REFUNDED', v_order.id, v_order.user_id, v_order.credits_granted, 0::numeric;
    return;
  end if;

  if v_order.credits_granted > 0 then
    select * into v_grant from public.grant_credits(
      v_order.user_id,
      v_order.credits_granted,
      'purchase',
      'billing:order:' || v_order.id::text,
      '支付购买积分',
      coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
        'order_id', v_order.id,
        'order_no', v_order.order_no,
        'provider', p_provider,
        'provider_trade_no', p_provider_trade_no
      )
    );
    v_balance := v_grant.balance;
  else
    select c.balance into v_balance from public.credit_accounts c where c.user_id = v_order.user_id;
  end if;

  update public.billing_orders o
     set status = 'paid',
         provider_order_id = coalesce(p_provider_trade_no, p_merchant_order_no),
         paid_at = coalesce(o.paid_at, now()),
         updated_at = now()
   where o.id = v_order.id;

  update public.payment_attempts a
     set status = 'paid',
         provider_trade_no = coalesce(p_provider_trade_no, a.provider_trade_no),
         paid_at = coalesce(a.paid_at, now()),
         provider_payload = coalesce(a.provider_payload, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
         updated_at = now()
   where a.id = v_attempt.id;

  return query select true, 'PAID', v_order.id, v_order.user_id, v_order.credits_granted, coalesce(v_balance, 0);
end;
$$;

revoke all on function public.complete_billing_order(text, text, text, text, bigint, jsonb) from public;
grant execute on function public.complete_billing_order(text, text, text, text, bigint, jsonb) to service_role;

commit;
