begin;

insert into public.credit_price_rules (
  metric,
  display_name,
  unit_name,
  credit_cost,
  enabled,
  max_units_per_request,
  notes
)
values (
  'networking_recommendation',
  'Networking 人脉建议',
  '次',
  3,
  true,
  1,
  '生成一套五阶段 Networking 建议'
)
on conflict (metric) do nothing;

notify pgrst, 'reload schema';

commit;
