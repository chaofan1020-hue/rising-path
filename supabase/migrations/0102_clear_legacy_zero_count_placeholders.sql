begin;

-- Before the null guard in job-source-telemetry, JSON null values were
-- coerced to numeric zero and recorded as if they were real crawl totals.
-- Clear those ambiguous zeros so the dashboard shows “未知” until a fresh
-- successful upstream snapshot supplies an actual count. A legitimate zero
-- will be written back by the next snapshot.
update public.job_company_sources
set official_expected_jobs = null,
    upstream_discovered_jobs = null,
    official_count_observed_at = null
where official_expected_jobs = 0
   or upstream_discovered_jobs = 0;

commit;
