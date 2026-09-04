begin;

alter table public.jobs
  add column if not exists employment_category varchar(20),
  add column if not exists experience_min_years numeric(4,1),
  add column if not exists experience_max_years numeric(4,1),
  add column if not exists experience_text varchar(500);

create index if not exists jobs_active_employment_category_idx
  on public.jobs (employment_category)
  where is_active = true and employment_category is not null;

create index if not exists jobs_active_experience_min_idx
  on public.jobs (experience_min_years)
  where is_active = true and experience_min_years is not null;

notify pgrst, 'reload schema';
commit;
