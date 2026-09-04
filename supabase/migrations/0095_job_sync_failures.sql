begin;

create table if not exists public.job_sync_failures (
  id bigserial primary key,
  dedupe_key text not null unique,
  source_system varchar(50) not null,
  company varchar(255),
  external_job_id text,
  source_url text,
  operation varchar(40) not null,
  payload jsonb not null default '{}'::jsonb,
  error_message text not null,
  attempts integer not null default 0,
  status varchar(20) not null default 'pending'
    check (status in ('pending', 'processing', 'resolved', 'dead')),
  next_retry_at timestamptz not null default now(),
  processing_owner uuid,
  processing_started_at timestamptz,
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_sync_failures_retry_idx
  on public.job_sync_failures(status, next_retry_at, id);
create index if not exists job_sync_failures_processing_idx
  on public.job_sync_failures(status, processing_started_at, id);
create index if not exists job_sync_failures_source_idx
  on public.job_sync_failures(source_system, company, status, id);

alter table public.job_sync_failures enable row level security;
revoke all on table public.job_sync_failures from anon, authenticated;
grant select, insert, update, delete on table public.job_sync_failures to service_role;

create or replace function public.enqueue_job_sync_failures(p_failures jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  queued_count integer := 0;
begin
  if jsonb_typeof(coalesce(p_failures, '[]'::jsonb)) <> 'array' then
    raise exception 'p_failures must be a JSON array';
  end if;

  insert into public.job_sync_failures (
    dedupe_key,
    source_system,
    company,
    external_job_id,
    source_url,
    operation,
    payload,
    error_message,
    attempts,
    status,
    next_retry_at,
    first_failed_at,
    last_failed_at,
    updated_at
  )
  select
    item->>'dedupe_key',
    left(coalesce(item->>'source_system', 'unknown'), 50),
    nullif(item->>'company', ''),
    nullif(item->>'external_job_id', ''),
    nullif(item->>'source_url', ''),
    left(coalesce(item->>'operation', 'unknown'), 40),
    case when jsonb_typeof(item->'payload') = 'object' then item->'payload' else '{}'::jsonb end,
    left(coalesce(item->>'error_message', '未知同步错误'), 2_000),
    1,
    'pending',
    now() + interval '1 minute',
    now(),
    now(),
    now()
  from jsonb_array_elements(p_failures) as item
  where nullif(item->>'dedupe_key', '') is not null
  on conflict (dedupe_key) do update set
    error_message = excluded.error_message,
    payload = excluded.payload,
    source_url = coalesce(excluded.source_url, public.job_sync_failures.source_url),
    attempts = least(public.job_sync_failures.attempts + 1, 100),
    status = case
      when public.job_sync_failures.status = 'dead' then 'dead'
      when public.job_sync_failures.attempts >= 4 then 'dead'
      else 'pending'
    end,
    next_retry_at = case
      when public.job_sync_failures.status = 'dead' then public.job_sync_failures.next_retry_at
      when public.job_sync_failures.attempts >= 4 then now()
      when public.job_sync_failures.attempts >= 3 then now() + interval '30 minutes'
      when public.job_sync_failures.attempts >= 2 then now() + interval '5 minutes'
      else now() + interval '1 minute'
    end,
    last_failed_at = now(),
    resolved_at = null,
    updated_at = now();

  get diagnostics queued_count = row_count;
  return queued_count;
end;
$$;

revoke all on function public.enqueue_job_sync_failures(jsonb) from public;
grant execute on function public.enqueue_job_sync_failures(jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
