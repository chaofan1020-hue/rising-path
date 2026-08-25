begin;

-- ATS external IDs are only unique within a company. Keeping the old
-- source/id index allows one company's record to overwrite another company's
-- record when two portals reuse the same numeric ID.
drop index if exists public.jobs_source_external_id_uidx;

create unique index if not exists jobs_source_company_external_id_uidx
  on public.jobs(source_system, company, external_job_id)
  where source_system is not null
    and company is not null
    and external_job_id is not null;

commit;
