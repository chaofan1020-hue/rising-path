begin;

-- Make the remaining legitimate closed rows explainable. These records have
-- an explicit deadline in the past but were created before lifecycle
-- maintenance started writing a reason to the sync ledger.
update public.job_sync_records as records
   set availability_status = 'closed',
       link_health = 'closed',
       last_link_error = '截止日期已过',
       availability_checked_at = coalesce(records.availability_checked_at, now()),
       updated_at = now()
  from public.jobs
 where jobs.id = records.job_id
   and jobs.source_system = 'collector_feed'
   and jobs.is_active = false
   and jobs.valid_through is not null
   and jobs.valid_through < now()
   and records.last_link_error is null;

notify pgrst, 'reload schema';

commit;
