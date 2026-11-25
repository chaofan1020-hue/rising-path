-- Phase 4 / R17: shadow write.  The old worker keeps writing public.jobs;
-- a row trigger mirrors each accepted change into jobs_v3 so shadow validation
-- sees the same state without running a second feed consumer.
--
-- The trigger is deliberately exception-safe: a shadow-only failure must never
-- reject a production job write. Failures are raised as warnings for the
-- reconciliation query instead of blocking the feed.
--
-- Rollback: drop trigger jobs_v3_shadow on public.jobs; drop function public.shadow_jobs_to_v3();

drop index if exists public.jobs_v3_ats_identity_uidx;
create unique index jobs_v3_ats_identity_uidx
  on public.jobs_v3 (source_key, external_job_id)
  where lane = 'ats' and is_active and source_key is not null and external_job_id is not null;

create or replace function public.shadow_jobs_to_v3()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lane text;
begin
  if tg_op = 'DELETE' then
    delete from public.jobs_v3 where id = old.id;
    return old;
  end if;

  v_lane := case when new.source_key is not null then 'ats' else 'legacy' end;
  begin
    delete from public.jobs_v3 where id = new.id;
    insert into public.jobs_v3
    select new.*, v_lane;
  exception when others then
    raise warning 'jobs_v3 shadow write skipped id=%: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists jobs_v3_shadow on public.jobs;
create trigger jobs_v3_shadow
  after insert or update or delete on public.jobs
  for each row execute function public.shadow_jobs_to_v3();

comment on function public.shadow_jobs_to_v3() is 'mirror public.jobs changes into the v3 shadow table; never blocks the source write';