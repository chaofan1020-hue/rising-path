begin;

-- Every private record is now owned by a Supabase Auth user. Existing rows
-- created by the legacy schema remain without an owner and are
-- intentionally invisible to authenticated users until they are migrated or
-- archived by an administrator.
alter table if exists public.resumes
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists public.applications
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists public.ai_matches
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists public.application_fields
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists public.field_mappings
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists public.favorites
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists public.interview_sessions
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists public.interview_feedback
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists public.job_submissions
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

drop index if exists public.resumes_access_code_id_idx;
drop index if exists public.applications_access_code_id_idx;
drop index if exists public.ai_matches_access_code_id_idx;
drop index if exists public.application_fields_access_code_id_idx;
drop index if exists public.field_mappings_access_code_id_idx;
drop index if exists public.interview_sessions_access_code_id_idx;

alter table if exists public.resumes drop column if exists access_code_id;
alter table if exists public.applications drop column if exists access_code_id;
alter table if exists public.ai_matches drop column if exists access_code_id;
alter table if exists public.application_fields drop column if exists access_code_id;
alter table if exists public.field_mappings drop column if exists access_code_id;
alter table if exists public.favorites drop column if exists access_code_id;
alter table if exists public.interview_sessions drop column if exists access_code_id;
alter table if exists public.interview_feedback drop column if exists access_code_id;

drop table if exists public.access_codes;

create index if not exists resumes_user_id_idx on public.resumes(user_id);
create index if not exists applications_user_id_idx on public.applications(user_id);
create index if not exists ai_matches_user_id_idx on public.ai_matches(user_id);
create index if not exists application_fields_user_id_idx on public.application_fields(user_id);
create index if not exists field_mappings_user_id_idx on public.field_mappings(user_id);
create index if not exists favorites_user_id_idx on public.favorites(user_id);
create index if not exists interview_sessions_user_id_idx on public.interview_sessions(user_id);
create index if not exists interview_feedback_user_id_idx on public.interview_feedback(user_id);
create index if not exists job_submissions_user_id_idx on public.job_submissions(user_id);

-- Durable throttling for public authentication endpoints. Only the service
-- role can call the function; no IP or email is stored, only a keyed hash.
create table if not exists public.auth_rate_limits (
  key_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

create or replace function public.consume_auth_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer,
  p_block_seconds integer
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.auth_rate_limits%rowtype;
  now_value timestamptz := now();
  retry_after integer;
begin
  insert into public.auth_rate_limits (key_hash)
  values (p_key_hash)
  on conflict (key_hash) do nothing;

  select * into current_row
  from public.auth_rate_limits
  where key_hash = p_key_hash
  for update;

  if current_row.blocked_until is not null and current_row.blocked_until > now_value then
    retry_after := greatest(1, ceil(extract(epoch from (current_row.blocked_until - now_value)))::integer);
    return query select false, retry_after;
    return;
  end if;

  if current_row.window_started_at + make_interval(secs => p_window_seconds) <= now_value then
    update public.auth_rate_limits
    set window_started_at = now_value,
        attempt_count = 1,
        blocked_until = null,
        updated_at = now_value
    where key_hash = p_key_hash;
    return query select true, 0;
    return;
  end if;

  if current_row.attempt_count >= p_limit then
    update public.auth_rate_limits
    set blocked_until = now_value + make_interval(secs => p_block_seconds),
        updated_at = now_value
    where key_hash = p_key_hash;
    return query select false, p_block_seconds;
    return;
  end if;

  update public.auth_rate_limits
  set attempt_count = attempt_count + 1,
      updated_at = now_value
  where key_hash = p_key_hash;
  return query select true, 0;
end;
$$;

revoke all on table public.auth_rate_limits from anon, authenticated;
revoke all on function public.consume_auth_rate_limit(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_auth_rate_limit(text, integer, integer, integer) to service_role;

-- Basic profile records make the Auth user boundary explicit and give the
-- admin dashboard a safe public-table projection instead of auth.users.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name varchar(120),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    nullif(left(coalesce(new.raw_user_meta_data ->> 'username', new.raw_user_meta_data ->> 'full_name', ''), 120), ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

insert into public.profiles (id, display_name, avatar_url)
select
  id,
  nullif(left(coalesce(raw_user_meta_data ->> 'username', raw_user_meta_data ->> 'full_name', ''), 120), ''),
  nullif(raw_user_meta_data ->> 'avatar_url', '')
from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- RLS is a second boundary behind the API's explicit ownership filters.
alter table public.resumes enable row level security;
alter table public.applications enable row level security;
alter table public.ai_matches enable row level security;
alter table public.application_fields enable row level security;
alter table public.field_mappings enable row level security;
alter table public.favorites enable row level security;
alter table public.interview_sessions enable row level security;
alter table public.interview_feedback enable row level security;
alter table public.job_submissions enable row level security;
alter table public.jobs enable row level security;
alter table public.company_config enable row level security;
alter table public.company_logos enable row level security;
alter table public.company_dna enable row level security;
alter table public.job_configs enable row level security;

drop policy if exists resumes_owner_all on public.resumes;
create policy resumes_owner_all on public.resumes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists applications_owner_all on public.applications;
create policy applications_owner_all on public.applications
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists ai_matches_owner_all on public.ai_matches;
create policy ai_matches_owner_all on public.ai_matches
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists application_fields_owner_all on public.application_fields;
create policy application_fields_owner_all on public.application_fields
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists field_mappings_owner_all on public.field_mappings;
create policy field_mappings_owner_all on public.field_mappings
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists favorites_owner_all on public.favorites;
create policy favorites_owner_all on public.favorites
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists interview_sessions_owner_all on public.interview_sessions;
create policy interview_sessions_owner_all on public.interview_sessions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists interview_feedback_owner_all on public.interview_feedback;
create policy interview_feedback_owner_all on public.interview_feedback
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists job_submissions_owner_all on public.job_submissions;
create policy job_submissions_owner_all on public.job_submissions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists jobs_read_active on public.jobs;
create policy jobs_read_active on public.jobs
  for select to anon, authenticated using (is_active = true);
drop policy if exists company_config_read_active on public.company_config;
create policy company_config_read_active on public.company_config
  for select to anon, authenticated using (is_active = true);
drop policy if exists company_logos_read on public.company_logos;
create policy company_logos_read on public.company_logos
  for select to anon, authenticated using (true);
drop policy if exists company_dna_read on public.company_dna;
create policy company_dna_read on public.company_dna
  for select to anon, authenticated using (true);
drop policy if exists job_configs_read_active on public.job_configs;
create policy job_configs_read_active on public.job_configs
  for select to anon, authenticated using (is_active = true);

grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.resumes, public.applications,
  public.ai_matches, public.application_fields, public.field_mappings, public.favorites,
  public.interview_sessions, public.interview_feedback, public.job_submissions to authenticated;
grant select on public.jobs, public.company_config, public.company_logos,
  public.company_dna, public.job_configs to anon, authenticated;

commit;
