-- 0166: C5 write parity — give jobs_v3 the duplicate guard public.jobs still has.
--
-- public.jobs carries
--   unique (source_system, company, external_job_id) where all three are not null
-- and jobs_v3 carries
--   unique (source_key, external_job_id) where lane = 'ats' and is_active ...
--
-- Those are not the same guarantee. While writes go to public.jobs (today) the
-- first index is the safety net and the forward shadow never needs it on v3.
-- Once C5 moves the writes to jobs_v3, the feed's insert path would lose it: the
-- app dedupes in JavaScript by source_key / job_url / title+company, so a race
-- between two workers would otherwise create a second active row.
--
-- Adding the index now is behaviour-neutral (dual write already keeps the two
-- tables identical, so the data is unique on both sides) and it means C5 does not
-- quietly relax a constraint. The guard below refuses to build it if a duplicate
-- exists, instead of failing halfway through index creation.

do $$
declare
  dupes bigint;
begin
  select count(*) into dupes
    from (
      select source_system, company, external_job_id
        from public.jobs_v3
       where source_system is not null
         and company is not null
         and external_job_id is not null
       group by 1, 2, 3
      having count(*) > 1
    ) d;

  if dupes > 0 then
    raise exception
      'refusing to build the unique index: % duplicate (source_system, company, external_job_id) groups', dupes
      using hint = 'Merge those rows first, then re-run 0166.';
  end if;
end;
$$;

create unique index if not exists jobs_v3_source_company_external_uidx
  on public.jobs_v3 (source_system, company, external_job_id)
  where source_system is not null
    and company is not null
    and external_job_id is not null;

comment on index public.jobs_v3_source_company_external_uidx is
  '0166 (C5): mirrors jobs_source_company_external_id_uidx so the write cutover keeps the same duplicate guard';

analyze public.jobs_v3;
notify pgrst, 'reload schema';