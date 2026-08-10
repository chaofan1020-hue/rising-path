begin;

-- 统一求职档案：一份经过用户确认、可被 AI 预填读取的结构化数据。
create table if not exists public.application_profiles (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  resume_id integer references public.resumes(id) on delete set null,
  profile jsonb not null default '{}'::jsonb,
  source jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

-- 表单字段模板：字段语义与具体 ATS 页面选择器的映射，支持用户私有模板和平台共享模板。
create table if not exists public.form_templates (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade,
  domain_pattern text not null,
  ats_type text,
  field_key text not null,
  semantic_key text not null,
  selector_hints jsonb not null default '{}'::jsonb,
  transform text,
  is_active boolean not null default true,
  usage_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, domain_pattern, field_key)
);

alter table public.application_profiles enable row level security;
drop policy if exists application_profiles_owner_all on public.application_profiles;
create policy application_profiles_owner_all on public.application_profiles
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.form_templates enable row level security;
drop policy if exists form_templates_select on public.form_templates;
create policy form_templates_select on public.form_templates
  for select to authenticated using (user_id is null or user_id = auth.uid());
drop policy if exists form_templates_owner_all on public.form_templates;
create policy form_templates_owner_all on public.form_templates
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists application_profiles_user_id_idx on public.application_profiles(user_id);
create index if not exists form_templates_domain_pattern_idx on public.form_templates(domain_pattern);
create index if not exists form_templates_semantic_key_idx on public.form_templates(semantic_key);

grant select, insert, update, delete on public.application_profiles to authenticated;
grant select, insert, update, delete on public.form_templates to authenticated;

commit;
