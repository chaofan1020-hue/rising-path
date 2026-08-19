begin;

-- The setup picker always filters by an active company's exact name and then
-- orders its most recent vacancies. This avoids a broad scan of the public
-- jobs feed before the region predicate is applied.
create index if not exists jobs_active_company_created_at_idx
  on public.jobs (company, created_at desc)
  where is_active = true;

commit;
