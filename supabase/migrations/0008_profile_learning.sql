begin;

alter table public.application_profiles
  add column if not exists field_stats jsonb not null default '{}'::jsonb;

alter table public.form_templates
  add column if not exists correction_count integer not null default 0;

create table if not exists public.profile_field_edits (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id bigint references public.application_profiles(id) on delete cascade,
  field_key text not null,
  old_value text,
  new_value text,
  source varchar(20) not null default 'manual',
  created_at timestamptz not null default now()
);

create table if not exists public.prefill_feedback (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id integer references public.jobs(id) on delete cascade,
  domain text,
  field_key text not null,
  semantic_key text,
  suggested_value text,
  final_value text,
  action varchar(20) not null,
  created_at timestamptz not null default now()
);

alter table public.profile_field_edits enable row level security;
drop policy if exists profile_field_edits_owner_all on public.profile_field_edits;
create policy profile_field_edits_owner_all on public.profile_field_edits
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.prefill_feedback enable row level security;
drop policy if exists prefill_feedback_owner_all on public.prefill_feedback;
create policy prefill_feedback_owner_all on public.prefill_feedback
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists profile_field_edits_user_id_idx on public.profile_field_edits(user_id);
create index if not exists profile_field_edits_profile_id_idx on public.profile_field_edits(profile_id);
create index if not exists prefill_feedback_user_id_idx on public.prefill_feedback(user_id);
create index if not exists prefill_feedback_job_id_idx on public.prefill_feedback(job_id);

grant select, insert, update, delete on public.profile_field_edits to authenticated;
grant select, insert, update, delete on public.prefill_feedback to authenticated;

commit;
