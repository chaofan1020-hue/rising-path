begin;

alter table public.profiles
  add column if not exists active_resume_id integer references public.resumes(id) on delete set null;

create index if not exists profiles_active_resume_id_idx
  on public.profiles(active_resume_id);

commit;
