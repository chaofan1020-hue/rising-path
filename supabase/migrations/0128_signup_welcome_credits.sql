begin;

-- Early-stage signup gift: every new Auth user receives 300 credits once.
-- The grant is idempotent so email signup, OAuth, OTP, and backfill can share
-- the same ledger key without double-paying.

create or replace function public.grant_signup_welcome_credits(p_user_id uuid)
returns table (account_id bigint, balance numeric, ledger_id bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  grant_amount numeric := 300;
  key_value text;
begin
  if p_user_id is null then
    return;
  end if;

  key_value := 'signup_welcome:' || p_user_id::text;

  begin
    return query
      select *
        from public.grant_credits(
          p_user_id,
          grant_amount,
          'grant',
          key_value,
          '新用户注册赠送 300 积分',
          jsonb_build_object('source', 'signup_welcome', 'amount', grant_amount)
        );
  exception
    when unique_violation then
      return query
        select a.id, a.balance, l.id
          from public.credit_accounts a
          join public.credit_ledger l
            on l.user_id = a.user_id
           and l.idempotency_key = key_value
         where a.user_id = p_user_id;
  end;
end;
$$;

revoke all on function public.grant_signup_welcome_credits(uuid) from public, anon, authenticated;
grant execute on function public.grant_signup_welcome_credits(uuid) to service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    nullif(left(coalesce(new.raw_user_meta_data ->> 'username', new.raw_user_meta_data ->> 'full_name', ''), 120), ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;

  begin
    perform public.grant_signup_welcome_credits(new.id);
  exception when others then
    raise warning 'signup welcome credits failed for %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

do $$
declare
  rec record;
begin
  for rec in select id from auth.users loop
    begin
      perform public.grant_signup_welcome_credits(rec.id);
    exception when others then
      raise warning 'signup welcome credits backfill failed for %: %', rec.id, sqlerrm;
    end;
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
