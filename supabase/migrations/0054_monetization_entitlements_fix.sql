begin;

create or replace function public.get_user_entitlements(p_user uuid)
returns table (
  plan_code text,
  plan_name text,
  feature_code text,
  quota_used bigint,
  quota_limit integer,
  grant_used bigint,
  grant_limit integer
)
language sql
stable
security definer
set search_path = public
as $$
  with selected_plan as (
    select p.*
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
    limit 1
  )
  select
    sp.code,
    sp.name,
    e.feature_code,
    coalesce(m.used_count, 0)::bigint,
    e.quota_per_month,
    coalesce(g.used_count, 0)::bigint,
    e.grant_on_signup
  from selected_plan sp
  join public.entitlements e on e.plan_id = sp.id and e.is_active
  left join public.usage_ledger m
    on m.user_id = p_user
   and m.feature_code = e.feature_code
   and m.bucket_key = to_char(now(), 'YYYY-MM')
  left join public.usage_ledger g
    on g.user_id = p_user
   and g.feature_code = e.feature_code
   and g.bucket_key = 'signup'
  order by e.sort_order;
$$;

commit;
