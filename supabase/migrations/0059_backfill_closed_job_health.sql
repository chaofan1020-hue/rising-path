begin;

-- Every inactive collector-feed row is already hidden from applicants. Make
-- that terminal state explicit in the synchronization ledger, including old
-- rows closed by deadlines or the previous reconciliation implementation.
update public.job_sync_records as records
   set availability_status = 'closed',
       link_health = 'closed',
       availability_checked_at = coalesce(records.availability_checked_at, now()),
       updated_at = now()
  from public.jobs
 where jobs.id = records.job_id
   and records.source_system = 'collector_feed'
   and jobs.is_active = false
   and (records.availability_status is distinct from 'closed' or records.link_health is distinct from 'closed');

notify pgrst, 'reload schema';

commit;
