begin;

-- A missing item in one feed pass is not proof that the job is closed. The
-- collector can paginate, retry, or temporarily omit a company. Keep the
-- observation for diagnostics, but only explicit close events, deadlines, or
-- a confirmed link check may deactivate a job.
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

  select exists (
    select 1
      from public.job_sync_records as records
      join public.jobs on jobs.id = records.job_id
     where records.source_system = p_source_system
       and jobs.is_active = true
       and (records.last_verified_at is null or records.last_verified_at < p_started_at)
       and (records.missing_from_feed_at is null or records.missing_from_feed_at < p_started_at)
  ) into remaining;

  return jsonb_build_object('missing', missing_count, 'closed', 0, 'done', not remaining);
end;
$$;

-- Undo only the mass closure produced by the old missing-feed rule. Explicit
-- close events and deadline closures do not carry this diagnostic message.
update public.jobs as jobs
   set is_active = true,
       is_closed = false,
       updated_at = now()
  from public.job_sync_records as records
 where records.job_id = jobs.id
   and records.source_system = 'collector_feed'
   and jobs.is_active = false
   and records.last_link_error = '上游连续两次对账未发现岗位';

update public.job_sync_records
   set missing_from_feed_at = null,
       missing_feed_checks = 0,
       availability_status = 'unknown',
       link_health = 'unknown',
       last_link_error = '已恢复，等待真实链接核验',
       availability_checked_at = now(),
       updated_at = now()
 where source_system = 'collector_feed'
   and last_link_error = '上游连续两次对账未发现岗位';

notify pgrst, 'reload schema';

commit;
