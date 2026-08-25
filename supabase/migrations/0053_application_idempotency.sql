begin;

-- A user can track a job only once. The API still performs a friendly lookup,
-- while this index closes the concurrent-request race.
create unique index if not exists applications_user_job_unique_idx
  on public.applications(user_id, job_id)
  where user_id is not null;

commit;
