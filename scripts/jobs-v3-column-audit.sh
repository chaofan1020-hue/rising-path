#!/bin/sh
# Full-column parity audit for the v3 shadow table (read-only).
#
# The 5-minute watchdog compares 8 hand-picked columns on every tick. That is
# cheap but blind to the rest: the shadow triggers copy whole rows today, and a
# future trigger/migration change could silently drop a column (posted_at,
# valid_through, matches_target_region, ...) while the 8-column check stays
# green. This audit compares *every* column the two tables share and exits
# non-zero on the first mismatch, so it can run before a cutover or after a
# migration instead of on every tick.
#
# Usage: sudo sh scripts/jobs-v3-column-audit.sh
set -eu

# `-i` is required: the audit feeds SQL through stdin, and `docker exec` without
# -i silently runs psql with no input (exit 0, zero output, false "OK").
DB="docker exec -i liorvix-supabase-db psql -U postgres -d postgres -At -F | -v ON_ERROR_STOP=1"
if [ "$(id -u)" -ne 0 ]; then
  DB="sudo -n $DB"
fi

# One session only: col_scan is a temp table, so a second psql call would not
# see it (that bug made the first version print OK data and still exit 1).
$DB <<'SQL'
create temp table col_scan(col text primary key, mismatches bigint);
do $$
declare
  r record;
  n bigint;
begin
  for r in
    select a.column_name
    from information_schema.columns a
    join information_schema.columns b
      on a.table_schema = b.table_schema and a.column_name = b.column_name
    where a.table_schema = 'public' and a.table_name = 'jobs'
      and b.table_schema = 'public' and b.table_name = 'jobs_v3'
    order by a.column_name
  loop
    execute format(
      'select count(*) from public.jobs j join public.jobs_v3 v using (id) where j.is_active and j.%I is distinct from v.%I',
      r.column_name, r.column_name)
      into n;
    insert into col_scan values (r.column_name, n);
  end loop;
end $$;
select 'compared=' || count(*) || ' mismatching_columns=' || count(*) filter (where mismatches > 0)
  || ' total_mismatches=' || coalesce(sum(mismatches), 0) from col_scan;
select col || '=' || mismatches from col_scan where mismatches > 0 order by mismatches desc;
do $$
declare
  total bigint;
begin
  select coalesce(sum(mismatches), 0) into total from col_scan;
  if total <> 0 then
    raise exception 'jobs_v3 column mismatch total=%', total;
  end if;
end $$;
SQL

echo "OK jobs_v3 all shared columns match"