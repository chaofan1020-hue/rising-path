begin;

-- Official detail workers read active collector-feed jobs by company and
-- resume from a durable id cursor. The older three-column index still forced
-- a filtered sort on larger companies (notably Microsoft), which could hit
-- the database statement timeout before the official page request started.
create index if not exists jobs_collector_company_active_id_idx
  on public.jobs(source_system, company, is_active, id);

commit;
