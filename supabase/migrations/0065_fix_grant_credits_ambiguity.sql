begin;

create or replace function public.grant_credits(
  p_user_id uuid,
  p_amount numeric,
  p_entry_type text default 'grant',
  p_idempotency_key text default null,
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (account_id bigint, balance numeric, ledger_id bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  account public.credit_accounts%rowtype;
  v_ledger_id bigint;
  key_value text := nullif(trim(coalesce(p_idempotency_key, '')), '');
begin
  if p_user_id is null or p_amount = 0 or p_entry_type not in ('grant', 'purchase', 'adjustment') then
    raise exception 'invalid credit grant';
  end if;

  if key_value is not null and exists (
    select 1 from public.credit_ledger
     where user_id = p_user_id and idempotency_key = key_value
  ) then
    select a.* into account from public.credit_accounts a where a.user_id = p_user_id;
    select l.id into v_ledger_id from public.credit_ledger l where l.user_id = p_user_id and l.idempotency_key = key_value;
    return query select account.id, account.balance, v_ledger_id;
    return;
  end if;

  insert into public.credit_accounts (user_id) values (p_user_id)
    on conflict (user_id) do nothing;
  select * into account from public.credit_accounts where user_id = p_user_id for update;
  if account.balance + p_amount < 0 then
    raise exception 'credit balance cannot be negative';
  end if;

  update public.credit_accounts as credit_account
     set balance = credit_account.balance + p_amount,
         lifetime_granted = credit_account.lifetime_granted + case when p_amount > 0 then p_amount else 0 end,
         version = credit_account.version + 1,
         updated_at = now()
   where credit_account.id = account.id
   returning * into account;

  insert into public.credit_ledger (
    user_id, account_id, entry_type, delta, balance_after, idempotency_key, reason, metadata
  ) values (
    p_user_id, account.id, p_entry_type, p_amount, account.balance, key_value, p_reason, coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_ledger_id;

  return query select account.id, account.balance, v_ledger_id;
end;
$$;

revoke all on function public.grant_credits(uuid, numeric, text, text, text, jsonb) from public;
grant execute on function public.grant_credits(uuid, numeric, text, text, text, jsonb) to service_role;

commit;
