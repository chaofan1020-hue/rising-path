-- Phase 3 / R13-R14: one-time active backfill into the shadow table.
-- Only active rows are copied. Closed rows remain in public.jobs and will be
-- re-created by authoritative close events during shadow validation; copying
-- 122k inactive rows would make the first shadow pass look complete while
-- obscuring whether close events actually work.
insert into public.jobs_v3
select
  j.*,
  case when j.source_key is not null then 'ats' else 'legacy' end as lane
from public.jobs j
where j.is_active;

select setval(
  'public.jobs_v3_id_seq',
  coalesce((select max(id) from public.jobs_v3), 1),
  (select count(*) > 0 from public.jobs_v3)
);

analyze public.jobs_v3;