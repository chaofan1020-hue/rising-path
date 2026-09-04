begin;

-- Give the dashboard a useful initial denominator before the first child
-- process returns its exact candidate count. This only fills untouched queue
-- rows and never overwrites a cursor or an in-progress result.
create or replace function public.seed_job_historical_field_review_totals()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer := 0;
begin
  update public.job_historical_field_reviews as reviews
     set total_candidates = sources.active_jobs,
         remaining_candidates = sources.active_jobs,
         updated_at = now()
    from public.job_company_sources as sources
   where sources.company_name = reviews.company_name
     and sources.is_active = true
     and reviews.total_candidates = 0
     and reviews.processed_candidates = 0
     and reviews.cursor_job_id is null
     and sources.active_jobs > 0;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.seed_job_historical_field_review_totals() from public, anon, authenticated;
grant execute on function public.seed_job_historical_field_review_totals() to service_role;

commit;
