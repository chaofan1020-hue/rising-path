begin;

-- Company metadata is kept separate from jobs so PostgREST can expose the
-- company_info relation used by the job APIs.
create table if not exists public.company_config (
  id serial primary key,
  company_name varchar(255) not null unique,
  short_desc text,
  full_desc text,
  industry varchar(255),
  headquarters varchar(255),
  founded_year integer,
  employees varchar(100),
  careers_page text,
  logo_url text,
  ats_type varchar(50),
  ats_id varchar(255),
  is_active boolean not null default true,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id serial primary key,
  title varchar(255) not null,
  company varchar(255) not null,
  company_config_id integer references public.company_config(id) on delete set null,
  region varchar(100) not null,
  direction varchar(100) not null,
  audience varchar(100) not null,
  job_type varchar(50),
  description text,
  overview text,
  responsibilities text,
  requirements text,
  nice_to_have text,
  salary_range varchar(100),
  job_url text,
  source_url text,
  sponsorship varchar(20),
  is_active boolean not null default true,
  is_closed boolean not null default false,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.access_codes (
  id serial primary key,
  code varchar(50) not null unique,
  name varchar(255),
  duration_days integer not null default 30,
  expires_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists public.resumes (
  id serial primary key,
  file_key text not null,
  file_name varchar(255) not null,
  parsed_content text,
  parsed_fields jsonb,
  user_info jsonb,
  profile jsonb,
  segmentation jsonb,
  segmentation_overrides jsonb,
  segmentation_confirmed boolean not null default false,
  access_code_id integer references public.access_codes(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.applications (
  id serial primary key,
  job_id integer not null references public.jobs(id) on delete cascade,
  resume_id integer not null references public.resumes(id) on delete cascade,
  access_code_id integer references public.access_codes(id) on delete cascade,
  status varchar(50) not null default 'pending',
  notes text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.application_fields (
  id serial primary key,
  job_id integer not null references public.jobs(id) on delete cascade,
  field_name varchar(255) not null,
  field_value text,
  field_type varchar(50),
  created_at timestamptz not null default now()
);

create table if not exists public.ai_matches (
  id serial primary key,
  resume_id integer not null references public.resumes(id) on delete cascade,
  job_id integer not null references public.jobs(id) on delete cascade,
  access_code_id integer references public.access_codes(id) on delete cascade,
  match_score integer not null,
  match_reason text,
  suggestions text,
  created_at timestamptz not null default now()
);

create table if not exists public.field_mappings (
  id serial primary key,
  access_code_id integer not null references public.access_codes(id) on delete cascade,
  company_pattern varchar(255) not null,
  field_name varchar(255) not null,
  target_field varchar(255) not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.favorites (
  id serial primary key,
  access_code_id integer not null references public.access_codes(id) on delete cascade,
  job_id integer not null references public.jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (access_code_id, job_id)
);

create table if not exists public.interview_sessions (
  id serial primary key,
  access_code_id integer not null references public.access_codes(id) on delete cascade,
  interview_type varchar(100) not null default 'general',
  job_description text,
  job_id integer references public.jobs(id) on delete set null,
  target_company varchar(255),
  mode varchar(30) not null default 'single',
  total_rounds integer not null default 1,
  current_round integer not null default 1,
  interviewer_ids jsonb not null default '[]'::jsonb,
  messages jsonb not null default '[]'::jsonb,
  status varchar(30) not null default 'in_progress',
  report jsonb,
  report_grade varchar(10),
  overall_score integer,
  summary text,
  resume_id integer references public.resumes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.company_dna (
  id serial primary key,
  company_name varchar(255) not null unique,
  aliases jsonb not null default '[]'::jsonb,
  dna jsonb not null,
  source varchar(30),
  hit_count integer not null default 0,
  version integer not null default 1,
  manually_edited boolean not null default false,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.interview_feedback (
  id serial primary key,
  session_id integer not null unique references public.interview_sessions(id) on delete cascade,
  access_code_id integer not null references public.access_codes(id) on delete cascade,
  company varchar(255),
  realism_score integer not null check (realism_score between 1 and 10),
  feedback_text text,
  status varchar(30) not null default 'pending_review',
  dna_source varchar(30),
  dna_version integer,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.company_logos (
  company_name varchar(255) primary key,
  id serial unique,
  logo_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.job_configs (
  id serial primary key,
  config_type varchar(100) not null,
  config_value text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.job_submissions (
  id serial primary key,
  title varchar(255) not null,
  company varchar(255) not null,
  region varchar(100),
  direction varchar(100),
  job_url text,
  description text,
  job_type varchar(50),
  salary_range varchar(100),
  contact_info text,
  submitter_info jsonb,
  status varchar(30) not null default 'pending',
  notes text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.health_check (
  id serial primary key,
  updated_at timestamptz default now()
);

create index if not exists jobs_region_idx on public.jobs(region);
create index if not exists jobs_direction_idx on public.jobs(direction);
create index if not exists jobs_audience_idx on public.jobs(audience);
create index if not exists jobs_created_at_idx on public.jobs(created_at);
create index if not exists jobs_job_url_idx on public.jobs(job_url);
create index if not exists resumes_access_code_id_idx on public.resumes(access_code_id);
create index if not exists resumes_created_at_idx on public.resumes(created_at);
create index if not exists applications_job_id_idx on public.applications(job_id);
create index if not exists applications_resume_id_idx on public.applications(resume_id);
create index if not exists applications_access_code_id_idx on public.applications(access_code_id);
create index if not exists applications_status_idx on public.applications(status);
create index if not exists applications_created_at_idx on public.applications(created_at);
create index if not exists application_fields_job_id_idx on public.application_fields(job_id);
create index if not exists ai_matches_resume_id_idx on public.ai_matches(resume_id);
create index if not exists ai_matches_job_id_idx on public.ai_matches(job_id);
create index if not exists ai_matches_access_code_id_idx on public.ai_matches(access_code_id);
create index if not exists field_mappings_access_code_id_idx on public.field_mappings(access_code_id);
create index if not exists interview_sessions_access_code_id_idx on public.interview_sessions(access_code_id);
create index if not exists interview_sessions_created_at_idx on public.interview_sessions(created_at);
create index if not exists interview_feedback_status_idx on public.interview_feedback(status);
create index if not exists job_submissions_status_idx on public.job_submissions(status);

-- Keep the relation populated when a job company matches a configured company.
create or replace function public.set_job_company_config_id()
returns trigger
language plpgsql
as $$
begin
  if new.company_config_id is null and new.company is not null then
    select id into new.company_config_id
    from public.company_config
    where company_name = new.company
    limit 1;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'jobs_set_company_config_id'
      and tgrelid = 'public.jobs'::regclass
  ) then
    create trigger jobs_set_company_config_id
      before insert or update of company on public.jobs
      for each row execute function public.set_job_company_config_id();
  end if;
end;
$$;

-- The application server uses the service role. RLS remains enabled so the
-- anon and authenticated keys cannot read test data directly by accident.
alter table public.company_config enable row level security;
alter table public.jobs enable row level security;
alter table public.access_codes enable row level security;
alter table public.resumes enable row level security;
alter table public.applications enable row level security;
alter table public.application_fields enable row level security;
alter table public.ai_matches enable row level security;
alter table public.field_mappings enable row level security;
alter table public.favorites enable row level security;
alter table public.interview_sessions enable row level security;
alter table public.interview_feedback enable row level security;
alter table public.company_dna enable row level security;
alter table public.company_logos enable row level security;
alter table public.job_configs enable row level security;
alter table public.job_submissions enable row level security;

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('risingpath-assets', 'risingpath-assets', true)
    on conflict (id) do update set public = true;
  end if;
end;
$$;

commit;
