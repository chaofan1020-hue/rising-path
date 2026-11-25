-- Phase 0/R04 follow-up: restore legacy rows that upstream still reports OPEN.
--
-- The link-health worker closed 1,914 legacy collector rows on 2026-11-25 after
-- 404/410 responses. Cross-checking every one of them against the upstream
-- database (company + external_job_id) showed 1,889 are genuinely CLOSED and
-- these 25 are still OPEN. They were false closes caused by treating a link
-- response as a lifecycle verdict, which `313d988` now requires upstream to
-- confirm before closing.
--
-- The restore is additive and idempotent: only rows that are still inactive
-- and still legacy (no source_key) are touched.
with restore(id) as (
  values
    (18186),(123207),(123208),(123211),(123216),(123221),(123222),(123224),
    (123227),(123229),(123243),(123246),(123248),(123249),(123255),(123265),
    (123275),(123285),(124032),(189337),(212448),(215232),(217141),(223879),(223884)
),
restored as (
  update public.jobs j
  set is_active = true,
      is_closed = false,
      updated_at = now()
  from restore r
  where j.id = r.id
    and j.is_active = false
    and j.source_key is null
  returning j.id
)
update public.job_sync_records s
set availability_status = 'unknown',
    link_health = 'unknown',
    link_check_failures = 0,
    last_link_error = '上游仍标记该岗位为 OPEN，链接 404/410 不构成下架证据（2026-11-25 回填）',
    availability_checked_at = now(),
    updated_at = now()
where s.job_id in (select id from restored);