begin;

-- Reserve the purchased credits before an external refund request. If the
-- provider call fails, finalize_billing_refund(..., false) restores them.
create or replace function public.prepare_billing_refund(p_order_id bigint)
returns table (ok boolean, code text, order_id bigint, user_id uuid, credits numeric, balance numeric)
language plpgsql security definer set search_path = public
as $$
declare
  billing_order public.billing_orders%rowtype;
  account public.credit_accounts%rowtype;
  refund_key text := 'billing:refund:order:' || p_order_id::text;
begin
  select * into billing_order from public.billing_orders where id = p_order_id for update;
  if billing_order.id is null then
    return query select false, 'ORDER_NOT_FOUND', p_order_id, null::uuid, 0::numeric, 0::numeric; return;
  end if;
  if billing_order.status = 'refunded' or exists (select 1 from public.credit_ledger where idempotency_key = refund_key) then
    select balance into account from public.credit_accounts where user_id = billing_order.user_id;
    return query select true, 'IDEMPOTENT_REPLAY', billing_order.id, billing_order.user_id, billing_order.credits_granted, coalesce(account.balance, 0); return;
  end if;
  if billing_order.status <> 'paid' then
    return query select false, 'ORDER_NOT_REFUNDABLE', billing_order.id, billing_order.user_id, billing_order.credits_granted, 0::numeric; return;
  end if;
  select * into account from public.credit_accounts where user_id = billing_order.user_id for update;
  if account.id is null then
    return query select false, 'CREDIT_ACCOUNT_NOT_FOUND', billing_order.id, billing_order.user_id, billing_order.credits_granted, 0::numeric; return;
  end if;
  if account.balance < billing_order.credits_granted then
    return query select false, 'CREDIT_BALANCE_INSUFFICIENT', billing_order.id, billing_order.user_id, billing_order.credits_granted, account.balance; return;
  end if;
  update public.credit_accounts
     set balance = balance - billing_order.credits_granted,
         lifetime_granted = greatest(0, lifetime_granted - billing_order.credits_granted),
         version = version + 1, updated_at = now()
   where id = account.id returning * into account;
  insert into public.credit_ledger (user_id, account_id, entry_type, delta, balance_after, idempotency_key, reason, metadata)
  values (billing_order.user_id, account.id, 'refund', -billing_order.credits_granted, account.balance, refund_key, '支付退款扣回积分', jsonb_build_object('order_id', billing_order.id, 'order_no', billing_order.order_no));
  update public.billing_orders set status = 'partially_refunded', updated_at = now() where id = billing_order.id;
  return query select true, 'REFUND_RESERVED', billing_order.id, billing_order.user_id, billing_order.credits_granted, account.balance;
end;
$$;

create or replace function public.finalize_billing_refund(p_order_id bigint, p_success boolean, p_reason text default null)
returns table (ok boolean, code text, order_id bigint, user_id uuid, credits numeric, balance numeric)
language plpgsql security definer set search_path = public
as $$
declare
  billing_order public.billing_orders%rowtype;
  account public.credit_accounts%rowtype;
  rollback_key text := 'billing:refund:rollback:' || p_order_id::text;
begin
  select * into billing_order from public.billing_orders where id = p_order_id for update;
  if billing_order.id is null then
    return query select false, 'ORDER_NOT_FOUND', p_order_id, null::uuid, 0::numeric, 0::numeric; return;
  end if;
  if p_success then
    update public.billing_orders set status = 'refunded', refunded_at = coalesce(refunded_at, now()), updated_at = now() where id = billing_order.id;
    select balance into account from public.credit_accounts where user_id = billing_order.user_id;
    return query select true, 'REFUNDED', billing_order.id, billing_order.user_id, billing_order.credits_granted, coalesce(account.balance, 0); return;
  end if;
  if billing_order.status <> 'partially_refunded' then
    select balance into account from public.credit_accounts where user_id = billing_order.user_id;
    return query select true, 'NO_ROLLBACK_NEEDED', billing_order.id, billing_order.user_id, billing_order.credits_granted, coalesce(account.balance, 0); return;
  end if;
  select * into account from public.credit_accounts where user_id = billing_order.user_id for update;
  update public.credit_accounts
     set balance = balance + billing_order.credits_granted,
         lifetime_granted = lifetime_granted + billing_order.credits_granted,
         version = version + 1, updated_at = now()
   where id = account.id returning * into account;
  insert into public.credit_ledger (user_id, account_id, entry_type, delta, balance_after, idempotency_key, reason, metadata)
  values (billing_order.user_id, account.id, 'refund', billing_order.credits_granted, account.balance, rollback_key, coalesce(p_reason, '支付退款失败，积分已恢复'), jsonb_build_object('order_id', billing_order.id, 'order_no', billing_order.order_no));
  update public.billing_orders set status = 'paid', updated_at = now() where id = billing_order.id;
  return query select true, 'ROLLBACK_COMPLETE', billing_order.id, billing_order.user_id, billing_order.credits_granted, account.balance;
end;
$$;

revoke all on function public.prepare_billing_refund(bigint) from public;
revoke all on function public.finalize_billing_refund(bigint, boolean, text) from public;
grant execute on function public.prepare_billing_refund(bigint) to service_role;
grant execute on function public.finalize_billing_refund(bigint, boolean, text) to service_role;

commit;

