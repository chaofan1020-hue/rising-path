begin;

-- Keep a company with an existing cursor at the front of the queue. This
-- makes each worker finish a bounded sequence of batches before rotating,
-- while still allowing the next company to run in the second worker slot.
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
     order by reviews.priority desc,
              case when reviews.cursor_job_id is not null then 0 else 1 end,
              reviews.next_run_at asc,
              reviews.updated_at asc,
              reviews.id asc
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

revoke all on function public.claim_job_historical_field_review(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_job_historical_field_review(uuid, integer) to service_role;

commit;
