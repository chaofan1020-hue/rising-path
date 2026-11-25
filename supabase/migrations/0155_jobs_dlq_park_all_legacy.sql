-- Phase 2 / R10 follow-up 2: park the whole legacy retry backlog.
--
-- 0154 parked the rows that had already produced the "cannot normalize" error.
-- The remaining backlog was still carrying the stale "no matching upstream job"
-- error from before the upstream lookup filters existed, but a lane split shows
-- they are all legacy or unmatched:
--   ATS rows: 0 | legacy rows (job.source_key is null): 392 | unmatched: 6
-- None of them can ever resolve: the v2 ATS lane rejects source_key-free
-- records by design (R04), and an unmatched row has no local lifecycle target.
-- Park them now instead of spending five upstream retries each. The payload and
-- error stay for audit; any future ATS failure still retries normally.
update public.job_sync_failures f
set status = 'dead',
    attempts = greatest(f.attempts, 5),
    next_retry_at = now(),
    processing_owner = null,
    processing_started_at = null,
    error_message = left(coalesce(f.error_message, '上游岗位无法标准化')
      || ' [parked: no ATS-lane target (legacy source_key-free or unmatched record)]', 2000),
    updated_at = now()
where f.status = 'pending'
  and f.source_system = 'collector_feed'
  and not exists (
    select 1
    from public.jobs j
    where j.company = f.company
      and j.external_job_id = f.external_job_id
      and j.source_key is not null
  );