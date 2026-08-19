begin;

-- The API calls this RPC with a user's authenticated Supabase client. The
-- previous SECURITY INVOKER implementation re-applied the jobs RLS policy in
-- every per-term candidate lookup and exceeded PostgREST's 10s statement
-- timeout, even though the same query was fast for an administrative DB
-- connection. The function only exposes active public jobs, so run the bounded
-- retrieval with the function owner and keep the public filter in SQL.
alter function public.search_ai_match_candidates_v5(text[], text[], text[], integer)
  security definer;

alter function public.search_ai_match_candidates_v5(text[], text[], text[], integer)
  set search_path to public;

revoke all on function public.search_ai_match_candidates_v5(text[], text[], text[], integer) from public;
grant execute on function public.search_ai_match_candidates_v5(text[], text[], text[], integer) to authenticated;

notify pgrst, 'reload schema';

commit;
