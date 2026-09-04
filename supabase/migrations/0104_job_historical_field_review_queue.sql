begin;

-- Historical field review is deliberately separate from the live collector
-- feed and the incremental official-details cursor.  It only records field
-- evidence outcomes; it never changes a job's lifecycle flags.
create table if not exists public.job_historical_field_reviews (
  id bigserial primary key,
  company_name varchar(255) not null unique,
  source_system varchar(80) not null,
  source_family varchar(50) not null,
  status varchar(20) not null default 'queued'
    check (status in ('queued', 'running', 'paused', 'completed', 'failed')),
  cursor_job_id bigint,
  total_candidates integer not null default 0 check (total_candidates >= 0),
  processed_candidates integer not null default 0 check (processed_candidates >= 0),
  remaining_candidates integer not null default 0 check (remaining_candidates >= 0),
  updated_jobs integer not null default 0 check (updated_jobs >= 0),
  verified_fields integer not null default 0 check (verified_fields >= 0),
  unavailable_fields integer not null default 0 check (unavailable_fields >= 0),
  skipped_jobs integer not null default 0 check (skipped_jobs >= 0),
  failed_jobs integer not null default 0 check (failed_jobs >= 0),
  attempts integer not null default 0 check (attempts >= 0),
  priority integer not null default 0,
  next_run_at timestamptz not null default now(),
  lease_owner uuid,
  lease_expires_at timestamptz,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_historical_field_reviews_claim_idx
  on public.job_historical_field_reviews(status, next_run_at, priority desc, updated_at);

create index if not exists job_historical_field_reviews_company_idx
  on public.job_historical_field_reviews(company_name, status);

-- Claim exactly one bounded company batch.  A worker crash leaves a task
-- recoverable after its short lease rather than leaving it permanently stuck.
create or replace function public.claim_job_historical_field_review(
  p_owner uuid,
  p_lease_seconds integer default 180
)
returns setof public.job_historical_field_reviews
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidate as (
    select reviews.id
      from public.job_historical_field_reviews as reviews
     where (
       reviews.status = 'queued'
       and reviews.next_run_at <= now()
     ) or (
       reviews.status = 'running'
       and (
         reviews.lease_expires_at is null
         or reviews.lease_expires_at <= now()
       )
     )
     order by reviews.priority desc, reviews.next_run_at asc, reviews.updated_at asc, reviews.id asc
     limit 1
     for update skip locked
  )
  update public.job_historical_field_reviews as reviews
     set status = 'running',
         attempts = case when reviews.status = 'running' then reviews.attempts + 1 else reviews.attempts end,
         lease_owner = p_owner,
         lease_expires_at = now() + make_interval(secs => least(greatest(p_lease_seconds, 60), 900)),
         started_at = coalesce(reviews.started_at, now()),
         last_heartbeat_at = now(),
         updated_at = now()
    from candidate
   where reviews.id = candidate.id
  returning reviews.*;
end;
$$;

alter table public.job_historical_field_reviews enable row level security;
revoke all on table public.job_historical_field_reviews from anon, authenticated;
grant select, insert, update, delete on table public.job_historical_field_reviews to service_role;
revoke all on function public.claim_job_historical_field_review(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_job_historical_field_review(uuid, integer) to service_role;

notify pgrst, 'reload schema';

commit;
