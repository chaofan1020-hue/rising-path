begin;

-- Durable source registry for every active collector company. This is
-- metadata only: it never changes jobs.is_active or jobs.is_closed.
create table if not exists public.job_company_sources (
  company_name varchar(255) primary key,
  is_active boolean not null default true,
  upstream_company_id text,
  active_jobs integer not null default 0 check (active_jobs >= 0),
  official_careers_url text,
  official_hosts jsonb not null default '[]'::jsonb,
  source_type varchar(50) not null,
  source_basis varchar(50) not null,
  external_job_id_field varchar(100),
  detail_url_rule text,
  detail_required boolean,
  region_scope varchar(50),
  timezone varchar(100),
  connector_name varchar(50),
  connector_board text,
  observed_source_family_distribution jsonb not null default '{}'::jsonb,
  source_hosts jsonb not null default '{}'::jsonb,
  field_coverage jsonb not null default '{}'::jsonb,
  last_attempted_at timestamptz,
  last_success_at timestamptz,
  next_retry_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  priority integer not null default 0,
  status varchar(50) not null,
  last_error text,
  notes text,
  last_observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists job_company_sources_upstream_id_uidx
  on public.job_company_sources(upstream_company_id)
  where upstream_company_id is not null;
create index if not exists job_company_sources_status_idx
  on public.job_company_sources(is_active, status, source_type, active_jobs desc);
create index if not exists job_company_sources_success_idx
  on public.job_company_sources(last_success_at, last_observed_at);

alter table public.job_company_sources enable row level security;
revoke all on table public.job_company_sources from anon, authenticated;
grant select, insert, update, delete on table public.job_company_sources to service_role;

commit;
