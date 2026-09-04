begin;

alter table public.job_sync_failures
  add column if not exists processing_owner uuid,
  add column if not exists processing_started_at timestamptz;

create index if not exists job_sync_failures_processing_idx
  on public.job_sync_failures(status, processing_started_at, id);

-- Claim rows atomically so multiple web instances cannot process the same
-- failure. Stale processing rows are recoverable after a worker crash.
create or replace function public.claim_job_sync_failure_batch(
  p_owner uuid,
  p_limit integer default 20,
  p_stale_after_seconds integer default 900
)
returns setof public.job_sync_failures
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select failures.id
      from public.job_sync_failures as failures
     where (
       failures.status = 'pending'
       and failures.next_retry_at <= now()
     ) or (
       failures.status = 'processing'
       and (
         failures.processing_started_at is null
         or failures.processing_started_at < now() - make_interval(secs => greatest(p_stale_after_seconds, 60))
       )
     )
     order by failures.next_retry_at asc, failures.id asc
     limit least(greatest(p_limit, 1), 100)
     for update skip locked
  )
  update public.job_sync_failures as failures
     set status = 'processing',
         processing_owner = p_owner,
         processing_started_at = now(),
         updated_at = now()
    from candidates
   where failures.id = candidates.id
  returning failures.*;
end;
$$;

create or replace function public.resolve_job_sync_failure(
  p_id bigint,
  p_owner uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.job_sync_failures
     set status = 'resolved',
         resolved_at = now(),
         processing_owner = null,
         processing_started_at = null,
         updated_at = now()
   where id = p_id
     and status = 'processing'
     and processing_owner = p_owner
  returning true;
$$;

create or replace function public.fail_job_sync_failure(
  p_id bigint,
  p_owner uuid,
  p_error_message text
)
returns varchar
language plpgsql
security definer
set search_path = public
as $$
declare
  next_attempts integer;
  next_status varchar(20);
begin
  select least(attempts + 1, 100)
    into next_attempts
    from public.job_sync_failures
   where id = p_id
     and status = 'processing'
     and processing_owner = p_owner
   for update;

  if next_attempts is null then
    return null;
  end if;

  next_status := case when next_attempts >= 5 then 'dead' else 'pending' end;
  update public.job_sync_failures
     set attempts = next_attempts,
         status = next_status,
         error_message = left(coalesce(p_error_message, '同步失败'), 2_000),
         next_retry_at = case
           when next_status = 'dead' then now()
           when next_attempts = 1 then now() + interval '1 minute'
           when next_attempts = 2 then now() + interval '5 minutes'
           when next_attempts = 3 then now() + interval '30 minutes'
           else now() + interval '2 hours'
         end,
         processing_owner = null,
         processing_started_at = null,
         last_failed_at = now(),
         resolved_at = null,
         updated_at = now()
   where id = p_id;
  return next_status;
end;
$$;

revoke all on function public.claim_job_sync_failure_batch(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.resolve_job_sync_failure(bigint, uuid) from public, anon, authenticated;
revoke all on function public.fail_job_sync_failure(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_job_sync_failure_batch(uuid, integer, integer) to service_role;
grant execute on function public.resolve_job_sync_failure(bigint, uuid) to service_role;
grant execute on function public.fail_job_sync_failure(bigint, uuid, text) to service_role;

notify pgrst, 'reload schema';

commit;
