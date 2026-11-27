-- 0163: make public.jobs_v3 ready to be the write table (C2).
--
-- RUN AS TWO TRANSACTIONS: the DDL part takes ACCESS EXCLUSIVE on jobs_v3 for
-- the duration of its transaction only (sub-second), and the 99k-row backfill
-- runs afterwards in its own statement so it does not hold that lock while it
-- writes. Applying the whole file with `psql -f` does exactly that: the explicit
-- `commit;` below ends the DDL transaction and the rest autocommits.
--
-- Before running, snapshot the exact rollback set of the backfill:
--   create table public.jobs_v3_c2_undo as
--     select j.id from public.jobs j
--      where not exists (select 1 from public.jobs_v3 v where v.id = j.id);
-- Undo: delete from public.jobs_v3 v using public.jobs_v3_c2_undo u where v.id = u.id;
--
-- Today the app writes public.jobs and migration 0149 keeps jobs_v3 in sync with
-- statement-level shadow triggers that copy rows positionally:
--   insert into public.jobs_v3 select n.*, lane, evidence from new_rows n;
-- That works only because jobs_v3 is exactly jobs + 5 trailing columns. C2 is
-- the step that stops relying on that coincidence, moves the business triggers
-- onto jobs_v3, and makes the two tables dual-write in both directions so C3 can
-- flip the application's write table without an outage.
--
-- What this migration does (DDL in transaction 1, backfill in transaction 2):
--   1. jobs_v3.id shares public.jobs_id_seq (jobs_v3_id_seq is left in place but
--      unused, so ids can never collide once the app inserts without an id).
--   2. jobs_v3 derives its own lane / closure_evidence, so a write that never
--      passed through public.jobs is still complete.
--   3. The three business triggers (company_config_id, matches_target_region,
--      ai_match_scope) are attached to jobs_v3 as well.
--   4. Forward shadow (jobs -> jobs_v3) is rewritten with EXPLICIT column lists
--      and becomes an upsert, so adding a column to either table can no longer
--      silently shift every trailing column, and an update no longer has to
--      delete+reinsert the row.
--   5. Reverse shadow (jobs_v3 -> jobs) is a BEFORE ROW trigger: it has to run
--      before the AFTER triggers on jobs_v3, because job_ai_match_scopes,
--      favorites, applications, ... all have ON DELETE CASCADE foreign keys to
--      public.jobs(id) and would otherwise violate the FK on a fresh id.
--      v3 deletes are deliberately NOT mirrored: deleting from public.jobs would
--      cascade into user data, and public.jobs is only a compatibility mirror
--      until C6. The stale row stays behind as an FK anchor.
--   6. Backfills the 99k historical closed rows that public.jobs still holds but
--      jobs_v3 never received (~122k closed rows total, ~23k already mirrored),
--      and reconciles public.job_ai_match_scopes with the region resolver (the
--      table drifted by 514 rows before the trigger covered every write path).
--   7. Loop guard: both directions check/set the transaction-local GUC
--      `liorvix.shadow_pass` ('jobs' or 'v3') so a mirrored write cannot bounce
--      back and forth forever.
--
-- Rollback: the DDL of section 1-5 is reversed by dropping the triggers and
-- functions created here, restoring the positional shadow functions from 0149
-- (they are quoted in that migration), and
--   alter table public.jobs_v3 alter column id set default nextval('public.jobs_v3_id_seq');
-- The backfill is additive and idempotent; undo it from the snapshot created
-- above: delete from public.jobs_v3 v using public.jobs_v3_c2_undo u where v.id = u.id;

begin;

-- ---------------------------------------------------------------------------
-- 1. Shared id sequence.
-- ---------------------------------------------------------------------------
alter table public.jobs_v3 alter column id set default nextval('public.jobs_id_seq'::regclass);
-- jobs_v3_id_seq must never be used again: drop its ownership so a future
-- `drop table jobs_v3` does not cascade-delete the sequence, and park it above
-- the live maximum so a stray default cannot collide.
select setval('public.jobs_v3_id_seq',
              greatest((select last_value from public.jobs_v3_id_seq),
                       (select coalesce(max(id), 1) from public.jobs_v3)));
alter sequence public.jobs_v3_id_seq owned by none;

-- ---------------------------------------------------------------------------
-- 2. Derived columns on jobs_v3.
-- ---------------------------------------------------------------------------
-- shadow_closure_evidence() takes public.jobs today; add the mirror overload so
-- the same evidence shape can be derived from a v3 row.
create or replace function public.shadow_closure_evidence(j public.jobs_v3)
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

create or replace function public.jobs_v3_sync_derived()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.lane := case when new.source_key is not null then 'ats' else 'legacy' end;
  new.closure_evidence := public.shadow_closure_evidence(new);
  return new;
end;
$$;

drop trigger if exists jobs_v3_sync_derived on public.jobs_v3;
create trigger jobs_v3_sync_derived
before insert or update on public.jobs_v3
for each row execute function public.jobs_v3_sync_derived();

-- public.jobs has ai_match_search as a GENERATED ALWAYS column; jobs_v3 has the
-- same column as a plain one, so it needs an explicit trigger to stay equal.
-- (PostgreSQL cannot turn an existing plain column into a generated one.)
create or replace function public.jobs_v3_sync_search()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.ai_match_search :=
    setweight(to_tsvector('simple'::regconfig, coalesce(new.title, '')::text), 'A')
    || setweight(to_tsvector('simple'::regconfig, coalesce(new.direction, '')::text), 'A')
    || setweight(to_tsvector('simple'::regconfig, coalesce(new.requirements, '')), 'B')
    || setweight(to_tsvector('simple'::regconfig, coalesce(new.description, '')), 'C');
  return new;
end;
$$;

drop trigger if exists jobs_v3_sync_search on public.jobs_v3;
create trigger jobs_v3_sync_search
before insert or update of title, direction, requirements, description on public.jobs_v3
for each row execute function public.jobs_v3_sync_search();

-- ---------------------------------------------------------------------------
-- 3. Business triggers on jobs_v3.
-- The functions only reference new.*, so they attach unchanged.
-- ---------------------------------------------------------------------------
drop trigger if exists jobs_set_company_config_id on public.jobs_v3;
create trigger jobs_set_company_config_id
before insert or update of company on public.jobs_v3
for each row execute function public.set_job_company_config_id();

drop trigger if exists jobs_sync_matches_target_region on public.jobs_v3;
create trigger jobs_sync_matches_target_region
before insert or update of region on public.jobs_v3
for each row execute function public.jobs_sync_matches_target_region();

drop trigger if exists jobs_sync_ai_match_scope on public.jobs_v3;
create trigger jobs_sync_ai_match_scope
after insert or update of region on public.jobs_v3
for each row execute function public.sync_job_ai_match_scope();

-- ---------------------------------------------------------------------------
-- 4. Forward shadow: jobs -> jobs_v3, explicit columns, upsert, guarded.
-- ---------------------------------------------------------------------------
create or replace function public.shadow_jobs_to_v3_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('liorvix.shadow_pass', true), '') = 'v3' then
    return null;
  end if;
  begin
    perform set_config('liorvix.shadow_pass', 'jobs', true);
    insert into public.jobs_v3 (
    id,
    title,
    company,
    company_config_id,
    region,
    direction,
    audience,
    job_type,
    description,
    overview,
    responsibilities,
    requirements,
    nice_to_have,
    salary_range,
    job_url,
    source_url,
    sponsorship,
    is_active,
    is_closed,
    last_verified_at,
    created_at,
    updated_at,
    source_system,
    external_job_id,
    valid_through,
    missing_from_feed_at,
    missing_feed_checks,
    last_link_checked_at,
    last_link_status,
    link_check_failures,
    experience_requirement,
    employment_type,
    workplace_type,
    deadline_source,
    salary_source,
    location_source,
    field_evidence,
    employment_category,
    experience_min_years,
    experience_max_years,
    experience_text,
    deadline_time_zone,
    posted_at,
    matches_target_region,
    source_key,
    first_seen_at,
    last_seen_at,
    detail_fetched_at,
    display_status,
    source_tier,
    dedupe_group_id,
    apply_url,
    source_updated_at,
    snapshot_id,
    is_list_only
    )
    select
    n.id,
    n.title,
    n.company,
    n.company_config_id,
    n.region,
    n.direction,
    n.audience,
    n.job_type,
    n.description,
    n.overview,
    n.responsibilities,
    n.requirements,
    n.nice_to_have,
    n.salary_range,
    n.job_url,
    n.source_url,
    n.sponsorship,
    n.is_active,
    n.is_closed,
    n.last_verified_at,
    n.created_at,
    n.updated_at,
    n.source_system,
    n.external_job_id,
    n.valid_through,
    n.missing_from_feed_at,
    n.missing_feed_checks,
    n.last_link_checked_at,
    n.last_link_status,
    n.link_check_failures,
    n.experience_requirement,
    n.employment_type,
    n.workplace_type,
    n.deadline_source,
    n.salary_source,
    n.location_source,
    n.field_evidence,
    n.employment_category,
    n.experience_min_years,
    n.experience_max_years,
    n.experience_text,
    n.deadline_time_zone,
    n.posted_at,
    n.matches_target_region,
    n.source_key,
    n.first_seen_at,
    n.last_seen_at,
    n.detail_fetched_at,
    n.display_status,
    n.source_tier,
    n.dedupe_group_id,
    n.apply_url,
    n.source_updated_at,
    n.snapshot_id,
    n.is_list_only
    from new_rows n
    on conflict (id) do update set
    title = excluded.title,
    company = excluded.company,
    company_config_id = excluded.company_config_id,
    region = excluded.region,
    direction = excluded.direction,
    audience = excluded.audience,
    job_type = excluded.job_type,
    description = excluded.description,
    overview = excluded.overview,
    responsibilities = excluded.responsibilities,
    requirements = excluded.requirements,
    nice_to_have = excluded.nice_to_have,
    salary_range = excluded.salary_range,
    job_url = excluded.job_url,
    source_url = excluded.source_url,
    sponsorship = excluded.sponsorship,
    is_active = excluded.is_active,
    is_closed = excluded.is_closed,
    last_verified_at = excluded.last_verified_at,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    source_system = excluded.source_system,
    external_job_id = excluded.external_job_id,
    valid_through = excluded.valid_through,
    missing_from_feed_at = excluded.missing_from_feed_at,
    missing_feed_checks = excluded.missing_feed_checks,
    last_link_checked_at = excluded.last_link_checked_at,
    last_link_status = excluded.last_link_status,
    link_check_failures = excluded.link_check_failures,
    experience_requirement = excluded.experience_requirement,
    employment_type = excluded.employment_type,
    workplace_type = excluded.workplace_type,
    deadline_source = excluded.deadline_source,
    salary_source = excluded.salary_source,
    location_source = excluded.location_source,
    field_evidence = excluded.field_evidence,
    employment_category = excluded.employment_category,
    experience_min_years = excluded.experience_min_years,
    experience_max_years = excluded.experience_max_years,
    experience_text = excluded.experience_text,
    deadline_time_zone = excluded.deadline_time_zone,
    posted_at = excluded.posted_at,
    matches_target_region = excluded.matches_target_region,
    source_key = excluded.source_key,
    first_seen_at = excluded.first_seen_at,
    last_seen_at = excluded.last_seen_at,
    detail_fetched_at = excluded.detail_fetched_at,
    display_status = excluded.display_status,
    source_tier = excluded.source_tier,
    dedupe_group_id = excluded.dedupe_group_id,
    apply_url = excluded.apply_url,
    source_updated_at = excluded.source_updated_at,
    snapshot_id = excluded.snapshot_id,
    is_list_only = excluded.is_list_only;
    perform set_config('liorvix.shadow_pass', '', true);
  exception when others then
    perform set_config('liorvix.shadow_pass', '', true);
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
  if coalesce(current_setting('liorvix.shadow_pass', true), '') = 'v3' then
    return null;
  end if;
  begin
    perform set_config('liorvix.shadow_pass', 'jobs', true);
    insert into public.jobs_v3 (
    id,
    title,
    company,
    company_config_id,
    region,
    direction,
    audience,
    job_type,
    description,
    overview,
    responsibilities,
    requirements,
    nice_to_have,
    salary_range,
    job_url,
    source_url,
    sponsorship,
    is_active,
    is_closed,
    last_verified_at,
    created_at,
    updated_at,
    source_system,
    external_job_id,
    valid_through,
    missing_from_feed_at,
    missing_feed_checks,
    last_link_checked_at,
    last_link_status,
    link_check_failures,
    experience_requirement,
    employment_type,
    workplace_type,
    deadline_source,
    salary_source,
    location_source,
    field_evidence,
    employment_category,
    experience_min_years,
    experience_max_years,
    experience_text,
    deadline_time_zone,
    posted_at,
    matches_target_region,
    source_key,
    first_seen_at,
    last_seen_at,
    detail_fetched_at,
    display_status,
    source_tier,
    dedupe_group_id,
    apply_url,
    source_updated_at,
    snapshot_id,
    is_list_only
    )
    select
    n.id,
    n.title,
    n.company,
    n.company_config_id,
    n.region,
    n.direction,
    n.audience,
    n.job_type,
    n.description,
    n.overview,
    n.responsibilities,
    n.requirements,
    n.nice_to_have,
    n.salary_range,
    n.job_url,
    n.source_url,
    n.sponsorship,
    n.is_active,
    n.is_closed,
    n.last_verified_at,
    n.created_at,
    n.updated_at,
    n.source_system,
    n.external_job_id,
    n.valid_through,
    n.missing_from_feed_at,
    n.missing_feed_checks,
    n.last_link_checked_at,
    n.last_link_status,
    n.link_check_failures,
    n.experience_requirement,
    n.employment_type,
    n.workplace_type,
    n.deadline_source,
    n.salary_source,
    n.location_source,
    n.field_evidence,
    n.employment_category,
    n.experience_min_years,
    n.experience_max_years,
    n.experience_text,
    n.deadline_time_zone,
    n.posted_at,
    n.matches_target_region,
    n.source_key,
    n.first_seen_at,
    n.last_seen_at,
    n.detail_fetched_at,
    n.display_status,
    n.source_tier,
    n.dedupe_group_id,
    n.apply_url,
    n.source_updated_at,
    n.snapshot_id,
    n.is_list_only
    from new_rows n
    on conflict (id) do update set
    title = excluded.title,
    company = excluded.company,
    company_config_id = excluded.company_config_id,
    region = excluded.region,
    direction = excluded.direction,
    audience = excluded.audience,
    job_type = excluded.job_type,
    description = excluded.description,
    overview = excluded.overview,
    responsibilities = excluded.responsibilities,
    requirements = excluded.requirements,
    nice_to_have = excluded.nice_to_have,
    salary_range = excluded.salary_range,
    job_url = excluded.job_url,
    source_url = excluded.source_url,
    sponsorship = excluded.sponsorship,
    is_active = excluded.is_active,
    is_closed = excluded.is_closed,
    last_verified_at = excluded.last_verified_at,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    source_system = excluded.source_system,
    external_job_id = excluded.external_job_id,
    valid_through = excluded.valid_through,
    missing_from_feed_at = excluded.missing_from_feed_at,
    missing_feed_checks = excluded.missing_feed_checks,
    last_link_checked_at = excluded.last_link_checked_at,
    last_link_status = excluded.last_link_status,
    link_check_failures = excluded.link_check_failures,
    experience_requirement = excluded.experience_requirement,
    employment_type = excluded.employment_type,
    workplace_type = excluded.workplace_type,
    deadline_source = excluded.deadline_source,
    salary_source = excluded.salary_source,
    location_source = excluded.location_source,
    field_evidence = excluded.field_evidence,
    employment_category = excluded.employment_category,
    experience_min_years = excluded.experience_min_years,
    experience_max_years = excluded.experience_max_years,
    experience_text = excluded.experience_text,
    deadline_time_zone = excluded.deadline_time_zone,
    posted_at = excluded.posted_at,
    matches_target_region = excluded.matches_target_region,
    source_key = excluded.source_key,
    first_seen_at = excluded.first_seen_at,
    last_seen_at = excluded.last_seen_at,
    detail_fetched_at = excluded.detail_fetched_at,
    display_status = excluded.display_status,
    source_tier = excluded.source_tier,
    dedupe_group_id = excluded.dedupe_group_id,
    apply_url = excluded.apply_url,
    source_updated_at = excluded.source_updated_at,
    snapshot_id = excluded.snapshot_id,
    is_list_only = excluded.is_list_only;
    perform set_config('liorvix.shadow_pass', '', true);
  exception when others then
    perform set_config('liorvix.shadow_pass', '', true);
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
  if coalesce(current_setting('liorvix.shadow_pass', true), '') = 'v3' then
    return null;
  end if;
  begin
    perform set_config('liorvix.shadow_pass', 'jobs', true);
    delete from public.jobs_v3 where id in (select id from old_rows);
    perform set_config('liorvix.shadow_pass', '', true);
  exception when others then
    perform set_config('liorvix.shadow_pass', '', true);
    raise warning 'jobs_v3 shadow delete skipped batch: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists jobs_v3_shadow_insert on public.jobs;
create trigger jobs_v3_shadow_insert
after insert on public.jobs
referencing new table as new_rows
for each statement execute function public.shadow_jobs_to_v3_insert();

drop trigger if exists jobs_v3_shadow_update on public.jobs;
create trigger jobs_v3_shadow_update
after update on public.jobs
referencing new table as new_rows old table as old_rows
for each statement execute function public.shadow_jobs_to_v3_update();

drop trigger if exists jobs_v3_shadow_delete on public.jobs;
create trigger jobs_v3_shadow_delete
after delete on public.jobs
referencing old table as old_rows
for each statement execute function public.shadow_jobs_to_v3_delete();

-- ---------------------------------------------------------------------------
-- 5. Reverse shadow: jobs_v3 -> jobs, BEFORE ROW (ordering matters, see header).
-- ---------------------------------------------------------------------------
create or replace function public.shadow_v3_to_jobs_upsert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('liorvix.shadow_pass', true), '') = 'jobs' then
    return new;
  end if;
  begin
    perform set_config('liorvix.shadow_pass', 'v3', true);
    insert into public.jobs (
    id,
    title,
    company,
    company_config_id,
    region,
    direction,
    audience,
    job_type,
    description,
    overview,
    responsibilities,
    requirements,
    nice_to_have,
    salary_range,
    job_url,
    source_url,
    sponsorship,
    is_active,
    is_closed,
    last_verified_at,
    created_at,
    updated_at,
    source_system,
    external_job_id,
    valid_through,
    missing_from_feed_at,
    missing_feed_checks,
    last_link_checked_at,
    last_link_status,
    link_check_failures,
    experience_requirement,
    employment_type,
    workplace_type,
    deadline_source,
    salary_source,
    location_source,
    field_evidence,
    employment_category,
    experience_min_years,
    experience_max_years,
    experience_text,
    deadline_time_zone,
    posted_at,
    matches_target_region,
    source_key,
    first_seen_at,
    last_seen_at,
    detail_fetched_at,
    display_status,
    source_tier,
    dedupe_group_id,
    apply_url,
    source_updated_at,
    snapshot_id,
    is_list_only
    ) values (
      new.id,      new.title,      new.company,      new.company_config_id,      new.region,      new.direction,      new.audience,      new.job_type,      new.description,      new.overview,      new.responsibilities,      new.requirements,      new.nice_to_have,      new.salary_range,      new.job_url,      new.source_url,      new.sponsorship,      new.is_active,      new.is_closed,      new.last_verified_at,      new.created_at,      new.updated_at,      new.source_system,      new.external_job_id,      new.valid_through,      new.missing_from_feed_at,      new.missing_feed_checks,      new.last_link_checked_at,      new.last_link_status,      new.link_check_failures,      new.experience_requirement,      new.employment_type,      new.workplace_type,      new.deadline_source,      new.salary_source,      new.location_source,      new.field_evidence,      new.employment_category,      new.experience_min_years,      new.experience_max_years,      new.experience_text,      new.deadline_time_zone,      new.posted_at,      new.matches_target_region,      new.source_key,      new.first_seen_at,      new.last_seen_at,      new.detail_fetched_at,      new.display_status,      new.source_tier,      new.dedupe_group_id,      new.apply_url,      new.source_updated_at,      new.snapshot_id,      new.is_list_only
    )
    on conflict (id) do update set
    title = excluded.title,
    company = excluded.company,
    company_config_id = excluded.company_config_id,
    region = excluded.region,
    direction = excluded.direction,
    audience = excluded.audience,
    job_type = excluded.job_type,
    description = excluded.description,
    overview = excluded.overview,
    responsibilities = excluded.responsibilities,
    requirements = excluded.requirements,
    nice_to_have = excluded.nice_to_have,
    salary_range = excluded.salary_range,
    job_url = excluded.job_url,
    source_url = excluded.source_url,
    sponsorship = excluded.sponsorship,
    is_active = excluded.is_active,
    is_closed = excluded.is_closed,
    last_verified_at = excluded.last_verified_at,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    source_system = excluded.source_system,
    external_job_id = excluded.external_job_id,
    valid_through = excluded.valid_through,
    missing_from_feed_at = excluded.missing_from_feed_at,
    missing_feed_checks = excluded.missing_feed_checks,
    last_link_checked_at = excluded.last_link_checked_at,
    last_link_status = excluded.last_link_status,
    link_check_failures = excluded.link_check_failures,
    experience_requirement = excluded.experience_requirement,
    employment_type = excluded.employment_type,
    workplace_type = excluded.workplace_type,
    deadline_source = excluded.deadline_source,
    salary_source = excluded.salary_source,
    location_source = excluded.location_source,
    field_evidence = excluded.field_evidence,
    employment_category = excluded.employment_category,
    experience_min_years = excluded.experience_min_years,
    experience_max_years = excluded.experience_max_years,
    experience_text = excluded.experience_text,
    deadline_time_zone = excluded.deadline_time_zone,
    posted_at = excluded.posted_at,
    matches_target_region = excluded.matches_target_region,
    source_key = excluded.source_key,
    first_seen_at = excluded.first_seen_at,
    last_seen_at = excluded.last_seen_at,
    detail_fetched_at = excluded.detail_fetched_at,
    display_status = excluded.display_status,
    source_tier = excluded.source_tier,
    dedupe_group_id = excluded.dedupe_group_id,
    apply_url = excluded.apply_url,
    source_updated_at = excluded.source_updated_at,
    snapshot_id = excluded.snapshot_id,
    is_list_only = excluded.is_list_only;
    perform set_config('liorvix.shadow_pass', '', true);
  exception when others then
    perform set_config('liorvix.shadow_pass', '', true);
    raise warning 'jobs reverse shadow skipped row %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists jobs_v3_shadow_to_jobs on public.jobs_v3;
create trigger jobs_v3_shadow_to_jobs
before insert or update on public.jobs_v3
for each row execute function public.shadow_v3_to_jobs_upsert();

commit;

-- ---------------------------------------------------------------------------
-- 6. Backfill historical closed rows that only public.jobs has.
-- Separate transaction on purpose: no exclusive table lock is held while the
-- ~99k rows (each firing 5 triggers and one upsert back into public.jobs) are
-- written. Guarded so the reverse shadow does not bounce every row as an upsert.
-- ---------------------------------------------------------------------------
do $$
declare
  normalized bigint;
  inserted bigint;
begin
  perform set_config('liorvix.shadow_pass', 'jobs', true);
  -- Rows inherited from the 0149 shadow already carry a lane, but a table that
  -- was seeded by hand (or a restored dump) may not: normalise before backfill.
  update public.jobs_v3 v
     set lane = case when v.source_key is not null then 'ats' else 'legacy' end
   where v.lane is distinct from case when v.source_key is not null then 'ats' else 'legacy' end;
  get diagnostics normalized = row_count;

  insert into public.jobs_v3 (
    id,
    title,
    company,
    company_config_id,
    region,
    direction,
    audience,
    job_type,
    description,
    overview,
    responsibilities,
    requirements,
    nice_to_have,
    salary_range,
    job_url,
    source_url,
    sponsorship,
    is_active,
    is_closed,
    last_verified_at,
    created_at,
    updated_at,
    source_system,
    external_job_id,
    valid_through,
    missing_from_feed_at,
    missing_feed_checks,
    last_link_checked_at,
    last_link_status,
    link_check_failures,
    experience_requirement,
    employment_type,
    workplace_type,
    deadline_source,
    salary_source,
    location_source,
    field_evidence,
    employment_category,
    experience_min_years,
    experience_max_years,
    experience_text,
    deadline_time_zone,
    posted_at,
    matches_target_region,
    source_key,
    first_seen_at,
    last_seen_at,
    detail_fetched_at,
    display_status,
    source_tier,
    dedupe_group_id,
    apply_url,
    source_updated_at,
    snapshot_id,
    is_list_only
  )
  select
    j.id,
    j.title,
    j.company,
    j.company_config_id,
    j.region,
    j.direction,
    j.audience,
    j.job_type,
    j.description,
    j.overview,
    j.responsibilities,
    j.requirements,
    j.nice_to_have,
    j.salary_range,
    j.job_url,
    j.source_url,
    j.sponsorship,
    j.is_active,
    j.is_closed,
    j.last_verified_at,
    j.created_at,
    j.updated_at,
    j.source_system,
    j.external_job_id,
    j.valid_through,
    j.missing_from_feed_at,
    j.missing_feed_checks,
    j.last_link_checked_at,
    j.last_link_status,
    j.link_check_failures,
    j.experience_requirement,
    j.employment_type,
    j.workplace_type,
    j.deadline_source,
    j.salary_source,
    j.location_source,
    j.field_evidence,
    j.employment_category,
    j.experience_min_years,
    j.experience_max_years,
    j.experience_text,
    j.deadline_time_zone,
    j.posted_at,
    j.matches_target_region,
    j.source_key,
    j.first_seen_at,
    j.last_seen_at,
    j.detail_fetched_at,
    j.display_status,
    j.source_tier,
    j.dedupe_group_id,
    j.apply_url,
    j.source_updated_at,
    j.snapshot_id,
    j.is_list_only
  from public.jobs j
  where not exists (select 1 from public.jobs_v3 v where v.id = j.id);
  get diagnostics inserted = row_count;

  perform set_config('liorvix.shadow_pass', '', true);
  raise notice 'jobs_v3 write-ready: normalised % lane(s), backfilled % row(s)', normalized, inserted;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Statistics and schema cache.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 6b. Reconcile public.job_ai_match_scopes with the region resolver.
-- That table is the AI retrieval pool (search_ai_match_candidates_v7). It was
-- only maintained by the AFTER trigger on public.jobs, and the trigger only
-- fires on writes that go through it, so pre-trigger rows and rows edited with
-- triggers bypassed drifted: on 2026-11-26 production had 333 target-region jobs
-- with no scope row, 22 scope rows for non-target jobs and 159 rows with a
-- stale scope value. 0163 attaches the same trigger to jobs_v3; this pass makes
-- the existing rows satisfy it. Idempotent: a second run changes nothing.
-- ---------------------------------------------------------------------------
do $$
declare
  inserted bigint;
  deleted bigint;
  updated bigint;
begin
  insert into public.job_ai_match_scopes (job_id, scope, updated_at)
  select v.id, public.ai_match_region_scope(v.region), now()
    from public.jobs_v3 v
   where public.ai_match_region_scope(v.region) is not null
     and not exists (select 1 from public.job_ai_match_scopes s where s.job_id = v.id)
  on conflict (job_id) do update
     set scope = excluded.scope, updated_at = excluded.updated_at;
  get diagnostics inserted = row_count;

  delete from public.job_ai_match_scopes s
   using public.jobs_v3 v
   where v.id = s.job_id
     and public.ai_match_region_scope(v.region) is null;
  get diagnostics deleted = row_count;

  update public.job_ai_match_scopes s
     set scope = public.ai_match_region_scope(v.region), updated_at = now()
    from public.jobs_v3 v
   where v.id = s.job_id
     and public.ai_match_region_scope(v.region) is not null
     and s.scope is distinct from public.ai_match_region_scope(v.region);
  get diagnostics updated = row_count;

  raise notice 'job_ai_match_scopes reconcile: +% -% ~%', inserted, deleted, updated;
end;
$$;

analyze public.jobs;
analyze public.jobs_v3;

notify pgrst, 'reload schema';
