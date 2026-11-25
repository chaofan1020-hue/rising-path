-- Phase 4 / R19: make the shadow close state auditable. The trigger writes a
-- compact evidence object for every close; existing shadow closes are backfilled
-- from the same source fields. This does not change public.jobs.
create or replace function public.shadow_jobs_to_v3()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lane text;
  v_evidence jsonb;
begin
  if tg_op = 'DELETE' then
    delete from public.jobs_v3 where id = old.id;
    return old;
  end if;

  v_lane := case when new.source_key is not null then 'ats' else 'legacy' end;
  v_evidence := case
    when new.is_active then '{}'::jsonb
    else jsonb_strip_nulls(jsonb_build_object(
      'kind', case
        when new.last_link_status in (404, 410) then 'link_check'
        when new.source_system = 'collector_feed' then 'feed'
        else 'manual_or_legacy'
      end,
      'at', to_char(new.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'source_system', new.source_system,
      'last_link_status', new.last_link_status,
      'last_link_checked_at', case when new.last_link_checked_at is null then null
        else to_char(new.last_link_checked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
    ))
  end;

  begin
    delete from public.jobs_v3 where id = new.id;
    insert into public.jobs_v3
    select new.*, v_lane, v_evidence;
  exception when others then
    raise warning 'jobs_v3 shadow write skipped id=%: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

-- Existing shadow rows that are already closed get the same evidence shape.
update public.jobs_v3 v
set closure_evidence = jsonb_strip_nulls(jsonb_build_object(
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
from public.jobs j
where v.id = j.id and not j.is_active and v.closure_evidence = '{}'::jsonb;