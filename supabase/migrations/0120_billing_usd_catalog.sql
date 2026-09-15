begin;

alter table public.billing_plans
  add column if not exists display_currency text not null default 'USD',
  add column if not exists display_amount_minor bigint;

update public.billing_plans
set display_currency = 'USD',
    display_amount_minor = case plan_code
      when 'free' then 0
      when 'cn_explorer_49' then 699
      when 'cn_job_99' then 1399
      when 'cn_high_199' then 2799
      when 'cn_pro_monthly' then 1799
      when 'cn_career_monthly' then 3499
      else coalesce(display_amount_minor, 0)
    end
where display_amount_minor is null
   or plan_code in ('free', 'cn_explorer_49', 'cn_job_99', 'cn_high_199', 'cn_pro_monthly', 'cn_career_monthly');

update public.billing_plans
set display_amount_minor = 0
where display_amount_minor is null;

alter table public.billing_plans
  alter column display_amount_minor set not null,
  alter column display_amount_minor set default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'billing_plans_display_amount_check'
  ) then
    alter table public.billing_plans
      add constraint billing_plans_display_amount_check check (display_amount_minor >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'billing_plans_display_currency_check'
  ) then
    alter table public.billing_plans
      add constraint billing_plans_display_currency_check check (display_currency ~ '^[A-Z]{3}$');
  end if;
end $$;

comment on column public.billing_plans.display_amount_minor is
  'Fixed catalog price in minor units of display_currency (USD cents). WeChat/Alipay still charge amount_minor in CNY.';
comment on column public.billing_plans.amount_minor is
  'Charge amount in minor units of currency (CNY fen) sent to domestic WeChat/Alipay.';

commit;
