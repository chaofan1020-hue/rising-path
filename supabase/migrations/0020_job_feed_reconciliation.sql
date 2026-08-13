begin;

alter table public.jobs
  add column if not exists source_system varchar(50),
  add column if not exists external_job_id text,
  add column if not exists valid_through timestamptz,
  add column if not exists missing_from_feed_at timestamptz,
  add column if not exists missing_feed_checks integer not null default 0,
  add column if not exists last_link_checked_at timestamptz,
  add column if not exists last_link_status integer,
  add column if not exists link_check_failures integer not null default 0;

-- Adopt records written by the existing collector integration. Other imports
-- use a distinct source_url (or no source_url), so they remain untouched.
update public.jobs
   set source_system = 'collector_feed'
 where source_system is null
   and last_verified_at is not null
   and source_url is not null
   and source_url = job_url;

create unique index if not exists jobs_source_external_id_uidx
  on public.jobs(source_system, external_job_id)
  where source_system is not null and external_job_id is not null;
create index if not exists jobs_source_active_verified_idx
  on public.jobs(source_system, is_active, last_verified_at);

create table if not exists public.job_sync_state (
  source_system varchar(50) primary key,
  cursor text,
  reconcile_cursor text,
  reconcile_started_at timestamptz,
  reconcile_pages integer not null default 0,
  reconcile_open_seen integer not null default 0,
  last_incremental_success_at timestamptz,
  last_reconcile_success_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0,
  lease_owner uuid,
  lease_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.job_sync_state enable row level security;
revoke all on table public.job_sync_state from anon, authenticated;
grant select, insert, update, delete on table public.job_sync_state to service_role;

create or replace function public.claim_job_sync(
  p_source_system text,
  p_owner uuid,
  p_ttl_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed boolean := false;
begin
  insert into public.job_sync_state (
    source_system,
    lease_owner,
    lease_expires_at,
    updated_at
  ) values (
    p_source_system,
    p_owner,
    now() + make_interval(secs => greatest(p_ttl_seconds, 60)),
    now()
  )
  on conflict (source_system) do update
    set lease_owner = excluded.lease_owner,
        lease_expires_at = excluded.lease_expires_at,
        updated_at = now()
    where public.job_sync_state.lease_expires_at is null
       or public.job_sync_state.lease_expires_at < now()
       or public.job_sync_state.lease_owner = p_owner
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

create or replace function public.release_job_sync(
  p_source_system text,
  p_owner uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.job_sync_state
     set lease_owner = null,
         lease_expires_at = null,
         updated_at = now()
   where source_system = p_source_system
     and lease_owner = p_owner;
$$;

create or replace function public.finalize_job_feed_reconcile(
  p_source_system text,
  p_started_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  missing_count integer := 0;
  closed_count integer := 0;
begin
  update public.jobs
     set missing_from_feed_at = coalesce(missing_from_feed_at, now()),
         missing_feed_checks = missing_feed_checks + 1,
         updated_at = now()
   where source_system = p_source_system
     and is_active = true
     and (last_verified_at is null or last_verified_at < p_started_at);
  get diagnostics missing_count = row_count;

  update public.jobs
     set is_active = false,
         is_closed = true,
         updated_at = now()
   where source_system = p_source_system
     and is_active = true
     and missing_feed_checks >= 2;
  get diagnostics closed_count = row_count;

  return jsonb_build_object('missing', missing_count, 'closed', closed_count);
end;
$$;

revoke all on function public.claim_job_sync(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_job_sync(text, uuid) from public, anon, authenticated;
revoke all on function public.finalize_job_feed_reconcile(text, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_job_sync(text, uuid, integer) to service_role;
grant execute on function public.release_job_sync(text, uuid) to service_role;
grant execute on function public.finalize_job_feed_reconcile(text, timestamptz) to service_role;

commit;
