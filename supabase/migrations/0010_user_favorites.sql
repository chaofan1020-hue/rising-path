begin;

-- Stage 3: make favorites a first-class, user-owned job signal.
alter table if exists public.favorites
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists favorites_user_id_idx
  on public.favorites(user_id);

create unique index if not exists favorites_user_job_unique_idx
  on public.favorites(user_id, job_id)
  where user_id is not null;

commit;
