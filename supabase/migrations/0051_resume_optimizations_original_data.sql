begin;

alter table public.resume_optimizations
  add column if not exists original_data jsonb not null default '{}'::jsonb;

commit;
