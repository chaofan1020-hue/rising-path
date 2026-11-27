-- 0164: C6 — stop the dual write and take public.jobs out of the API schema.
--
-- Run this only after all of the following are true:
--   * C5 finished: JOBS_WRITE_SOURCE=v3 has been live for 7 days and the
--     reconcile watchdog reported zero drift for that whole window;
--   * a dedicated dump of public.jobs exists and `pg_restore -l` reads it;
--   * the nightly backup has run at least once since the write cutover.
--
-- What it does
--   1. drops the forward shadow (jobs -> jobs_v3) and the reverse shadow
--      (jobs_v3 -> jobs). The two tables stop mirroring each other.
--   2. repoints the 12 foreign keys that reference jobs(id) to jobs_v3(id),
--      keeping each constraint's ON DELETE action. Added NOT VALID first, then
--      validated, so the exclusive lock on the referencing table is brief.
--   3. moves jobs_id_seq ownership to jobs_v3.id. Without this, dropping the old
--      table would cascade-delete the sequence and take the live table with it.
--   4. drops the legacy jobs_listing view (it is built on jobs; jobs_listing_v3
--      stays). The read switch keeps serving jobs_listing_v3.
--   5. moves public.jobs into the `archive` schema as jobs_20261127. PostgREST
--      only exposes public (PGRST_DB_SCHEMAS=public), so the archive stops being
--      an API surface while the data stays queryable through psql.
--
-- Disk is NOT freed here. Moving a table is a catalog operation; 0165 drops it
-- and that is what returns the ~5.5 GB.
--
-- Guards
--   * `liorvix.c6_confirm` must be 'yes'; a migration runner that applies files
--     automatically will fail loudly instead of archiving the live table.
--   * the two tables must hold exactly the same ids, which is the same invariant
--     the C4 watchdog checks.
--
-- Rollback (before 0165 drops the archive)
--   begin;
--     alter table archive.jobs_20261127 set schema public;
--     alter table public.jobs_20261127 rename to jobs;
--     alter sequence public.jobs_id_seq owned by public.jobs.id;
--     -- repoint the 12 constraints back: same drop/add pairs with
--     -- references public.jobs(id);
--     create view public.jobs_listing as ... (see 0141);
--   commit;
--   then re-apply 0163 sections 4-5 (forward + reverse shadow functions and
--   triggers) to resume the dual write. The 0163 file is idempotent.

do $$
begin
  if coalesce(current_setting('liorvix.c6_confirm', true), '') <> 'yes' then
    raise exception
      'C6 is not confirmed. Re-run with: set liorvix.c6_confirm = ''yes'';'
      using hint = 'Only run this after C5 has been live for 7 days.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 0. Preconditions: the two tables must be identical in ids.
-- ---------------------------------------------------------------------------
do $$
declare
  jobs_rows bigint;
  v3_rows bigint;
  v3_only bigint;
begin
  select count(*) into jobs_rows from public.jobs;
  select count(*) into v3_rows from public.jobs_v3;
  select count(*) into v3_only
    from public.jobs_v3 v
   where not exists (select 1 from public.jobs j where j.id = v.id);

  if jobs_rows <> v3_rows or v3_only <> 0 then
    raise exception 'refusing to archive: jobs=% v3=% v3_only=%', jobs_rows, v3_rows, v3_only;
  end if;
  raise notice 'preconditions ok: % rows on both tables', jobs_rows;
end;
$$;

begin;
-- A C6 run is short, but never let a stuck client block the feed for long.
set local lock_timeout = '10s';
set local statement_timeout = 0;

-- ---------------------------------------------------------------------------
-- 1. End the dual write.
-- ---------------------------------------------------------------------------
drop view if exists public.jobs_listing;

drop trigger if exists jobs_v3_shadow_to_jobs on public.jobs_v3;
drop function if exists public.shadow_v3_to_jobs_upsert();

drop trigger if exists jobs_v3_shadow_insert on public.jobs;
drop trigger if exists jobs_v3_shadow_update on public.jobs;
drop trigger if exists jobs_v3_shadow_delete on public.jobs;

drop function if exists public.shadow_jobs_to_v3_insert();
drop function if exists public.shadow_jobs_to_v3_update();
drop function if exists public.shadow_jobs_to_v3_delete();
drop function if exists public.shadow_jobs_to_v3();
drop function if exists public.shadow_jobs_to_v3_statement();
-- The jobs-typed overload only served the jobs-side trigger. The jobs_v3
-- overload stays and keeps filling jobs_v3.closure_evidence.
drop function if exists public.shadow_closure_evidence(public.jobs);

-- ---------------------------------------------------------------------------
-- 2. Repoint the foreign keys to jobs_v3.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('ai_match_feedback',    'ai_match_feedback_job_id_fkey',    'cascade'),
      ('ai_matches',           'ai_matches_job_id_fkey',           'cascade'),
      ('ai_usage_events',      'ai_usage_events_job_id_fkey',      'set null'),
      ('application_fields',   'application_fields_job_id_fkey',   'cascade'),
      ('applications',         'applications_job_id_fkey',         'cascade'),
      ('favorites',            'favorites_job_id_fkey',            'cascade'),
      ('interview_questions',  'interview_questions_job_id_fkey',  'set null'),
      ('interview_sessions',   'interview_sessions_job_id_fkey',   'set null'),
      ('job_ai_match_scopes',  'job_ai_match_scopes_job_id_fkey',  'cascade'),
      ('job_sync_records',     'job_sync_records_job_id_fkey',     'cascade'),
      ('prefill_feedback',     'prefill_feedback_job_id_fkey',     'cascade'),
      ('resume_optimizations', 'resume_optimizations_job_id_fkey', 'set null')
    ) as t(tbl, conname, on_delete)
  loop
    if exists (
      select 1
        from pg_constraint c
       where c.conname = r.conname
         and c.conrelid = format('public.%I', r.tbl)::regclass
         and c.confrelid = 'public.jobs_v3'::regclass
    ) then
      continue;               -- already repointed (re-run)
    end if;

    execute format('alter table public.%I drop constraint if exists %I', r.tbl, r.conname);
    execute format(
      'alter table public.%I add constraint %I foreign key (job_id) references public.jobs_v3(id) on delete %s not valid',
      r.tbl, r.conname, r.on_delete);
    raise notice 'repointed %.% -> jobs_v3(id) on delete %', r.tbl, r.conname, r.on_delete;
  end loop;
end;
$$;

-- Validate outside the ADD so the exclusive lock is held only for the catalog
-- update. This is the only part that touches rows (job_sync_records: 452k).
alter table public.ai_match_feedback    validate constraint ai_match_feedback_job_id_fkey;
alter table public.ai_matches           validate constraint ai_matches_job_id_fkey;
alter table public.ai_usage_events      validate constraint ai_usage_events_job_id_fkey;
alter table public.application_fields   validate constraint application_fields_job_id_fkey;
alter table public.applications         validate constraint applications_job_id_fkey;
alter table public.favorites            validate constraint favorites_job_id_fkey;
alter table public.interview_questions  validate constraint interview_questions_job_id_fkey;
alter table public.interview_sessions   validate constraint interview_sessions_job_id_fkey;
alter table public.job_ai_match_scopes  validate constraint job_ai_match_scopes_job_id_fkey;
alter table public.job_sync_records     validate constraint job_sync_records_job_id_fkey;
alter table public.prefill_feedback     validate constraint prefill_feedback_job_id_fkey;
alter table public.resume_optimizations validate constraint resume_optimizations_job_id_fkey;

-- ---------------------------------------------------------------------------
-- 3. jobs_id_seq must survive the archive move.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
      from pg_depend d
      join pg_class s on s.oid = d.objid
     where s.relname = 'jobs_id_seq'
       and d.refobjid = 'public.jobs'::regclass
  ) then
    alter sequence public.jobs_id_seq owned by public.jobs_v3.id;
    raise notice 'jobs_id_seq ownership moved to jobs_v3.id';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Move the old table out of the API schema.
-- ---------------------------------------------------------------------------
create schema if not exists archive;

do $$
begin
  if to_regclass('archive.jobs_20261127') is not null then
    raise notice 'archive.jobs_20261127 already exists, skipping the move';
  else
    alter table public.jobs set schema archive;
    alter table archive.jobs rename to jobs_20261127;
    raise notice 'public.jobs moved to archive.jobs_20261127';
  end if;
end;
$$;

commit;

analyze public.jobs_v3;
notify pgrst, 'reload schema';