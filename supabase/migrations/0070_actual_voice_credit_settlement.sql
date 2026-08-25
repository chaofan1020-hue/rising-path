begin;

create or replace function public.settle_credits_actual(
  p_reservation_id bigint,
  p_actual_units numeric,
  p_status text default 'committed',
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  reservation public.credit_reservations%rowtype;
  account public.credit_accounts%rowtype;
  rule public.credit_price_rules%rowtype;
  actual_units numeric := greatest(0, coalesce(p_actual_units, 0));
  actual_credits numeric;
  difference numeric;
  ledger_balance numeric;
begin
  if p_status not in ('committed', 'released') then return false; end if;
  select * into reservation from public.credit_reservations where id = p_reservation_id for update;
  if reservation.id is null or reservation.status <> 'reserved' then return false; end if;

  select * into account from public.credit_accounts where id = reservation.account_id for update;
  if p_status = 'released' then
    actual_units := 0;
  end if;
  select * into rule from public.credit_price_rules where metric = reservation.metric;
  actual_credits := round(greatest(0, actual_units * coalesce(rule.credit_cost, 0)), 4);
  difference := round(reservation.credits - actual_credits, 4);

  if difference < 0 then
    if account.balance < abs(difference) then return false; end if;
    update public.credit_accounts
       set balance = balance + difference,
           lifetime_spent = lifetime_spent - difference,
           version = version + 1,
           updated_at = now()
     where id = account.id;
  elsif difference > 0 then
    update public.credit_accounts
       set balance = balance + difference,
           lifetime_spent = greatest(0, lifetime_spent - difference),
           version = version + 1,
           updated_at = now()
     where id = account.id;
  end if;

  select balance into ledger_balance from public.credit_accounts where id = account.id;
  update public.credit_ledger
     set delta = -actual_credits,
         balance_after = ledger_balance,
         reason = coalesce(p_reason, case when p_status = 'released' then '语音调用未产生有效用量，已退回' else '按实际语音时长结算' end),
         metadata = metadata || jsonb_build_object('actual_units', actual_units, 'actual_credits', actual_credits, 'settled_at', now())
   where reservation_id = reservation.id and entry_type = 'reserve';

  update public.credit_reservations
     set units = greatest(actual_units, 0.0001), credits = greatest(actual_credits, 0.0001), status = case when p_status = 'released' then 'released' else 'committed' end, settled_at = now()
   where id = reservation.id;
  return true;
end;
$$;

revoke all on function public.settle_credits_actual(bigint, numeric, text, text) from public;
grant execute on function public.settle_credits_actual(bigint, numeric, text, text) to service_role;

commit;
