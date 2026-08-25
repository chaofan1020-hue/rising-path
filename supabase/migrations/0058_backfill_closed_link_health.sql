begin;

create or replace function public.finalize_job_feed_reconcile_batch(
  p_source_system text,
  p_started_at timestamptz,
  p_batch_size integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  missing_count integer := 0;
  closed_count integer := 0;
  batch_size integer := greatest(1, least(coalesce(p_batch_size, 1000), 5000));
  remaining boolean := false;
begin
  with candidates as (
    select records.job_id
      from public.job_sync_records as records
      join public.jobs on jobs.id = records.job_id
     where records.source_system = p_source_system
       and jobs.is_active = true
       and (records.last_verified_at is null or records.last_verified_at < p_started_at)
       and (records.missing_from_feed_at is null or records.missing_from_feed_at < p_started_at)
     order by records.job_id
     limit batch_size
  )
  update public.job_sync_records as records
     set missing_from_feed_at = now(),
         missing_feed_checks = records.missing_feed_checks + 1,
         updated_at = now()
    from candidates
   where records.job_id = candidates.job_id;
  get diagnostics missing_count = row_count;

  with candidates as (
    select jobs.id
      from public.jobs
      join public.job_sync_records as records on records.job_id = jobs.id
     where records.source_system = p_source_system
       and jobs.is_active = true
       and records.missing_feed_checks >= 2
     order by jobs.id
     limit batch_size
  )
  update public.jobs as jobs
     set is_active = false,
         is_closed = true,
         updated_at = now()
    from candidates
   where jobs.id = candidates.id;
  get diagnostics closed_count = row_count;

  update public.job_sync_records as records
     set availability_status = 'closed',
         link_health = 'closed',
         last_link_error = '上游连续两次对账未发现岗位',
         availability_checked_at = now(),
         updated_at = now()
    from public.jobs
   where jobs.id = records.job_id
     and records.source_system = p_source_system
     and jobs.is_active = false
     and records.missing_feed_checks >= 2
     and records.missing_from_feed_at >= p_started_at
     and (records.availability_status is distinct from 'closed' or records.link_health is distinct from 'closed');

  select exists (
    select 1
      from public.job_sync_records as records
      join public.jobs on jobs.id = records.job_id
     where records.source_system = p_source_system
       and jobs.is_active = true
       and (records.last_verified_at is null or records.last_verified_at < p_started_at)
       and (records.missing_from_feed_at is null or records.missing_from_feed_at < p_started_at)
  ) into remaining;

  return jsonb_build_object('missing', missing_count, 'closed', closed_count, 'done', not remaining);
end;
$$;

update public.job_sync_records as records
   set availability_status = 'closed',
       link_health = 'closed',
       last_link_error = coalesce(records.last_link_error, '上游连续两次对账未发现岗位'),
       availability_checked_at = coalesce(records.availability_checked_at, now()),
       updated_at = now()
  from public.jobs
 where jobs.id = records.job_id
   and records.source_system = 'collector_feed'
   and jobs.is_active = false
   and records.missing_feed_checks >= 2
   and (records.availability_status is null or records.link_health is null);

notify pgrst, 'reload schema';

commit;
