-- Phase 2 / R10: park permanently invalid legacy failures.
--
-- These rows were produced before the source_key/source_tier guard. Their
-- upstream records have no source_key, so `fetchJobForSyncRetry` cannot
-- normalize them and every retry is guaranteed to fail. Keep the payload and
-- error for audit, but move them out of the active retry queue instead of
-- spending five retries per row.
update public.job_sync_failures
set status = 'dead',
    attempts = greatest(attempts, 5),
    next_retry_at = now(),
    processing_owner = null,
    processing_started_at = null,
    error_message = left(coalesce(error_message, 'source_tier 无效') ||
      ' [parked: legacy source_key-free payload is not supported by v2 ATS feed]', 2000),
    updated_at = now()
where source_system = 'collector_feed'
  and status = 'pending'
  and error_message like '%source_tier%'
  and first_failed_at < '2026-11-25 04:00:00+00';