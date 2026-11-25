-- Phase 4 / R20: statement-level shadow triggers. PostgreSQL does not allow a
-- transition table on a trigger with more than one event, so insert/update/delete
-- get separate triggers. The previous row trigger was correct but slow.
create or replace function public.shadow_closure_evidence(j public.jobs)
returns jsonb
language sql
stable
as $$
  select case
    when j.is_active then '{}'::jsonb
    else jsonb_strip_nulls(jsonb_build_object(
      'kind', case
        when j.last_link_status in (404, 410) then 'link_check'
        when j.source_system = 'collector_feed' then 'feed'
        else 'manual_or_legacy'
      end,
      'at', to_char(j.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'source_system', j.source_system,
      'last_link_status', j.last_link_status,
      'last_link_checked_at', case when j.last_link_checked_at is null then null
        else to_char(j.last_link_checked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
    ))
  end;
$$;

create or replace function public.shadow_jobs_to_v3_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.jobs_v3
    select n.*, case when n.source_key is not null then 'ats' else 'legacy' end,
      public.shadow_closure_evidence(n)
    from new_rows n;
  exception when others then
    raise warning 'jobs_v3 shadow insert skipped batch: %', sqlerrm;
  end;
  return null;
end;
$$;

create or replace function public.shadow_jobs_to_v3_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    delete from public.jobs_v3 where id in (select id from new_rows);
    insert into public.jobs_v3
    select n.*, case when n.source_key is not null then 'ats' else 'legacy' end,
      public.shadow_closure_evidence(n)
    from new_rows n;
  exception when others then
    raise warning 'jobs_v3 shadow update skipped batch: %', sqlerrm;
  end;
  return null;
end;
$$;

create or replace function public.shadow_jobs_to_v3_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    delete from public.jobs_v3 where id in (select id from old_rows);
  exception when others then
    raise warning 'jobs_v3 shadow delete skipped batch: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists jobs_v3_shadow on public.jobs;
drop trigger if exists jobs_v3_shadow_insert on public.jobs;
drop trigger if exists jobs_v3_shadow_update on public.jobs;
drop trigger if exists jobs_v3_shadow_delete on public.jobs;

create trigger jobs_v3_shadow_insert
after insert on public.jobs
referencing new table as new_rows
for each statement execute function public.shadow_jobs_to_v3_insert();

create trigger jobs_v3_shadow_update
after update on public.jobs
referencing new table as new_rows old table as old_rows
for each statement execute function public.shadow_jobs_to_v3_update();

create trigger jobs_v3_shadow_delete
after delete on public.jobs
referencing old table as old_rows
for each statement execute function public.shadow_jobs_to_v3_delete();

notify pgrst, 'reload schema';