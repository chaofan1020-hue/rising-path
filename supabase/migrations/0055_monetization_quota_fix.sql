begin;

update public.entitlements e
set quota_per_month = 0,
    updated_at = now()
from public.plans p
where p.id = e.plan_id
  and p.code = 'basic'
  and e.feature_code in ('networking', 'dashboard_advanced', 'auto_apply')
  and e.quota_per_month is null;

create or replace function public.consume_feature_usage(
  p_user uuid,
  p_feature text,
  p_quantity integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_id bigint;
  v_plan_code text;
  v_quota integer;
  v_grant integer;
  v_used integer;
  v_limit integer;
  v_bucket text := to_char(now(), 'YYYY-MM');
begin
  if p_user is null or p_feature is null or p_quantity is null or p_quantity < 1 then
    return jsonb_build_object('allowed', false, 'reason', 'INVALID_REQUEST');
  end if;

  select p.id, p.code into v_plan_id, v_plan_code
  from public.plans p
  where p.is_active
    and (
      p.code = 'basic'
      or exists (
        select 1
        from public.subscriptions s
        where s.user_id = p_user
          and s.plan_id = p.id
          and s.status in ('active', 'trialing')
          and (s.current_period_end is null or s.current_period_end > now())
      )
    )
  order by case when p.code = 'basic' then 1 else 0 end, p.sort_order
  limit 1;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'PLAN_REQUIRED');
  end if;

  select e.quota_per_month, e.grant_on_signup into v_quota, v_grant
  from public.entitlements e
  where e.plan_id = v_plan_id
    and e.feature_code = p_feature
    and e.is_active;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'PLAN_REQUIRED', 'plan', v_plan_code);
  end if;

  if v_quota is null then
    if v_plan_code = 'pro' then
      return jsonb_build_object(
        'allowed', true,
        'reason', 'OK',
        'plan', v_plan_code,
        'unlimited', true
      );
    end if;
    return jsonb_build_object(
      'allowed', false,
      'reason', 'PLAN_REQUIRED',
      'plan', v_plan_code
    );
  end if;

  if v_quota >= p_quantity then
    insert into public.usage_ledger (
      user_id,
      feature_code,
      bucket_key,
      source,
      used_count,
      limit_value,
      period_start,
      period_end
    )
    values (
      p_user,
      p_feature,
      v_bucket,
      'monthly',
      p_quantity,
      v_quota,
      date_trunc('month', now()),
      date_trunc('month', now()) + interval '1 month'
    )
    on conflict (user_id, feature_code, bucket_key)
    do update set
      used_count = public.usage_ledger.used_count + excluded.used_count,
      updated_at = now()
    where public.usage_ledger.used_count + excluded.used_count <= public.usage_ledger.limit_value
    returning used_count, limit_value into v_used, v_limit;

    if found then
      return jsonb_build_object(
        'allowed', true,
        'reason', 'OK',
        'plan', v_plan_code,
        'used', v_used,
        'limit', v_limit,
        'remaining', v_limit - v_used
      );
    end if;
  end if;

  select used_count, limit_value into v_used, v_limit
  from public.usage_ledger
  where user_id = p_user
    and feature_code = p_feature
    and bucket_key = v_bucket
  limit 1;
  if found then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'USAGE_EXHAUSTED',
      'plan', v_plan_code,
      'used', v_used,
      'limit', v_limit,
      'remaining', 0
    );
  end if;

  if v_grant is not null and v_grant >= p_quantity then
    insert into public.usage_ledger (
      user_id,
      feature_code,
      bucket_key,
      source,
      used_count,
      limit_value
    )
    values (
      p_user,
      p_feature,
      'signup',
      'grant',
      p_quantity,
      v_grant
    )
    on conflict (user_id, feature_code, bucket_key)
    do update set
      used_count = public.usage_ledger.used_count + excluded.used_count,
      updated_at = now()
    where public.usage_ledger.used_count + excluded.used_count <= public.usage_ledger.limit_value
    returning used_count, limit_value into v_used, v_limit;

    if found then
      return jsonb_build_object(
        'allowed', true,
        'reason', 'OK',
        'plan', v_plan_code,
        'source', 'grant',
        'used', v_used,
        'limit', v_limit,
        'remaining', v_limit - v_used
      );
    end if;
  end if;

  return jsonb_build_object(
    'allowed', false,
    'reason', 'USAGE_EXHAUSTED',
    'plan', v_plan_code,
    'remaining', 0
  );
end;
$$;

commit;
