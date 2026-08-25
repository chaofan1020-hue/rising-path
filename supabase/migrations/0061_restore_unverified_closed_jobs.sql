begin;

-- Older reconciliation versions could mark a job closed without recording a
-- link response. A closed flag with no HTTP status, no error, no check time,
-- and no missing-feed observations is not evidence that the posting ended.
-- Restore those rows and let the link-health worker establish a real state.
with candidates as (
  select jobs.id
    from public.jobs
    join public.job_sync_records as records on records.job_id = jobs.id
   where jobs.source_system = 'collector_feed'
     and jobs.is_active = false
     and (jobs.valid_through is null or jobs.valid_through >= now())
     and records.availability_status = 'closed'
     and records.link_health = 'closed'
     and records.last_link_status is null
     and records.last_link_http_status is null
     and records.last_link_error is null
     and coalesce(records.missing_feed_checks, 0) = 0
)
update public.jobs as jobs
   set is_active = true,
       is_closed = false,
       updated_at = now()
  from candidates
 where jobs.id = candidates.id;

update public.job_sync_records as records
   set availability_status = 'unknown',
       link_health = 'unknown',
       link_check_failures = 0,
       last_link_error = '已恢复：原关闭状态没有真实链接核验依据，等待重新核验',
       availability_checked_at = null,
       updated_at = now()
  from public.jobs
 where jobs.id = records.job_id
   and jobs.source_system = 'collector_feed'
   and jobs.is_active = true
   and records.availability_status = 'closed'
   and records.link_health = 'closed'
   and records.last_link_status is null
   and records.last_link_http_status is null
   and records.last_link_error is null
   and coalesce(records.missing_feed_checks, 0) = 0;

notify pgrst, 'reload schema';

commit;
