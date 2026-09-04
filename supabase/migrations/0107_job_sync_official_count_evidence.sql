begin;

alter table public.job_company_sources
  add column if not exists official_count_status text,
  add column if not exists official_count_source text,
  add column if not exists official_count_lower_bound integer;

create index if not exists job_company_sources_official_count_status_idx
  on public.job_company_sources(is_active, official_count_status, official_expected_jobs);

commit;
