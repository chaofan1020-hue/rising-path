-- Recompute `matches_target_region` (and the `job_ai_match_scopes` rows that
-- depend on `region`) for postings whose stored flag disagrees with the current
-- region functions, after migration 0160.
--
-- Run repeatedly until the final UPDATE reports 0 rows. Each statement is
-- self-contained so it can be executed with psql by hand:
--
--   sudo docker exec -i liorvix-supabase-db psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/migrations/0160_job_region_scope_state_codes.sql
--   sudo docker exec -i liorvix-supabase-db psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < scripts/jobs-region-backfill.sql
--
-- `set region = region` is intentional: the BEFORE trigger
-- `jobs_sync_matches_target_region` only fires on UPDATE OF region, and the
-- statement-level shadow trigger then mirrors the rows into `jobs_v3`.

set statement_timeout = '120s';

with batch as (
  select id
  from public.jobs
  where public.job_region_matches_target(region) is distinct from matches_target_region
  order by id
  limit 5000
)
update public.jobs j
set region = j.region
from batch b
where j.id = b.id;

select count(*) as remaining_mismatches
from public.jobs
where public.job_region_matches_target(region) is distinct from matches_target_region;