-- 0165: C6 step 2 — drop the archived jobs table and give the disk back.
--
-- 0164 only *moves* public.jobs into the archive schema; a table move is a
-- catalog operation and frees nothing. This file is what actually returns the
-- ~5.5 GB, so it must only run after the archive dump is written and verified:
--
--   pg_dump -Fc -Z6 --schema=archive -t archive.jobs_20261127 \
--     -f /opt/liorvix-backups/jobs-archive-20261127.dump
--   pg_restore -l /opt/liorvix-backups/jobs-archive-20261127.dump | head
--
-- Keep that dump for 30 days, then delete it. The nightly DB backup already
-- contains the same rows (it is the 11-27 dump), so the dedicated file is the
-- belt-and-braces copy, not the only one.
--
-- Guards
--   * `liorvix.c6_drop_confirm` must be 'yes'.
--   * the table must still have its rows; an empty archive means something went
--     wrong upstream and dropping it would destroy the only copy.
--
-- Rollback: restore the dump into public.jobs (it is a plain table, no
-- dependencies anymore because 0164 repointed every foreign key).

do $$
declare
  archive_rows bigint;
begin
  if coalesce(current_setting('liorvix.c6_drop_confirm', true), '') <> 'yes' then
    raise exception
      'C6 drop is not confirmed. Re-run with: set liorvix.c6_drop_confirm = ''yes'';'
      using hint = 'Write and verify the archive dump first.';
  end if;

  if to_regclass('archive.jobs_20261127') is null then
    raise notice 'archive.jobs_20261127 does not exist, nothing to drop';
    return;
  end if;

  select count(*) into archive_rows from archive.jobs_20261127;
  if archive_rows < 400000 then
    raise exception
      'refusing to drop archive.jobs_20261127: only % rows, expected the full ~452k', archive_rows;
  end if;
  raise notice 'dropping archive.jobs_20261127 with % rows', archive_rows;
end;
$$;

drop table if exists archive.jobs_20261127;

-- Only removes the schema when nothing else lives in it.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'archive')
     and not exists (
       select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'archive' and c.relkind in ('r','p','v','m')
     ) then
    drop schema archive;
    raise notice 'archive schema removed (it is empty)';
  else
    raise notice 'archive schema kept: it still holds objects';
  end if;
end;
$$;

analyze public.jobs_v3;
notify pgrst, 'reload schema';