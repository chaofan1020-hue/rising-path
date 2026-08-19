begin;

-- v7 uses job_ai_match_scopes for region filtering. These former expression
-- indexes were only used by the v1-v6 implementations and are now redundant.
drop index if exists public.jobs_active_ai_match_scope_direction_idx;
drop index if exists public.jobs_active_ai_match_scope_created_idx;

-- Keep only the RPC used by the application. Removing old versions prevents
-- accidental regressions to the slower region-regex retrieval path.
drop function if exists public.search_ai_match_candidates(text[], text[], text[], integer);
drop function if exists public.search_ai_match_candidates_v2(text[], text[], text[], integer);
drop function if exists public.search_ai_match_candidates_v3(text[], text[], text[], integer);
drop function if exists public.search_ai_match_candidates_v4(text[], text[], text[], integer);
drop function if exists public.search_ai_match_candidates_v5(text[], text[], text[], integer);
drop function if exists public.search_ai_match_candidates_v6(text[], text[], text[], integer);

notify pgrst, 'reload schema';

commit;
