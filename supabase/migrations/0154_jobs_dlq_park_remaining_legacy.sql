-- Phase 2 / R10 follow-up: park the remaining legacy retry backlog.
--
-- After 0150 parked the pre-04:00 backlog, 452 rows were still pending. The
-- upstream lookup used by the retry worker (`fetchJobForSyncRetry`) had been
-- sending `external_job_id`/`source_url` filters the upstream feed silently
-- ignored, so every retry failed with "no matching job" and nothing was learned.
-- With those filters supported (2026-11-25) the retries reach the real record and
-- split cleanly in two:
--   * ATS records (source_key present) now normalize and resolve normally.
--   * legacy records (no source_key) still cannot normalize, because the v2 ATS
--     lane explicitly rejects source_key-free payloads (R04 freeze).
-- Park only the second group, and only when the local job row also proves the
-- record is legacy, so no ATS row is parked by mistake.
update public.job_sync_failures f
set status = 'dead',
    attempts = greatest(f.attempts, 5),
    next_retry_at = now(),
    processing_owner = null,
    processing_started_at = null,
    error_message = left(coalesce(f.error_message, '上游岗位当前仍无法标准化')
      || ' [parked: legacy source_key-free record, ATS lane rejects it by design]', 2000),
    updated_at = now()
from public.jobs j
where f.status = 'pending'
  and f.source_system = 'collector_feed'
  and f.error_message like '上游岗位当前仍无法标准化%'
  and j.company = f.company
  and j.external_job_id = f.external_job_id
  and j.source_key is null;