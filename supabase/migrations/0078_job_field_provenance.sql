begin;

-- Keep public job values separate from the evidence that justified them. A
-- missing or low-confidence upstream value must never silently replace a
-- field that was previously verified or corrected by an administrator.
alter table public.jobs
  add column if not exists employment_type varchar(50),
  add column if not exists workplace_type varchar(50),
  add column if not exists deadline_source varchar(64),
  add column if not exists salary_source varchar(64),
  add column if not exists location_source varchar(64),
  add column if not exists field_evidence jsonb not null default '{}'::jsonb;

create index if not exists jobs_active_employment_type_idx
  on public.jobs (employment_type)
  where is_active = true and employment_type is not null;

create index if not exists jobs_active_workplace_type_idx
  on public.jobs (workplace_type)
  where is_active = true and workplace_type is not null;

notify pgrst, 'reload schema';

commit;
