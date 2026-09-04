begin;

-- Counts used by the operations dashboard must distinguish the official
-- source's reported total from the upstream collector's discovered total.
-- `upstream_active_jobs` remains the collector's persisted open-job count and
-- is intentionally not used for official-vs-upstream reconciliation.
alter table public.job_company_sources
  add column if not exists official_expected_jobs integer,
  add column if not exists upstream_discovered_jobs integer,
  add column if not exists official_count_observed_at timestamptz;

create index if not exists job_company_sources_official_count_idx
  on public.job_company_sources(is_active, official_expected_jobs, upstream_discovered_jobs);

commit;
