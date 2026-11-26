-- Backfill `country_code` / `continent` for rows written before migration 0161.
--
-- The resolver is a BEFORE trigger (`jobs_sync_country_code`) that only fires on
-- INSERT or UPDATE OF region, so existing rows keep NULL until something touches
-- their region. `set region = region` is intentional: it is a no-op value-wise
-- but names the column, which fires the trigger.
--
-- The backfill targets `public.jobs_v3` directly (that is where the trigger and
-- the read path live). Touching `public.jobs` instead would work too, but it
-- would round-trip every row through the statement-level shadow trigger for no
-- gain.
--
-- Run it with `scripts/jobs-country-backfill.sh`, which drives the batches and
-- carries the high-water mark. Manual equivalent:
--
--   sudo docker exec -i liorvix-supabase-db psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -v last_id=0 -f - < scripts/jobs-country-backfill.sql
--
-- Re-running is safe: rows that already have a country are skipped, and rows the
-- resolver genuinely cannot place stay NULL and are reported at the end so the
-- taxonomy can be extended with a plain INSERT.

set statement_timeout = '180s';

with batch as (
  select id
  from public.jobs_v3
  where id > :last_id
    and country_code is null
  order by id
  limit 5000
),
upd as (
  update public.jobs_v3 v
  set region = v.region
  from batch b
  where v.id = b.id
  returning v.id
)
select coalesce(max(id), :last_id) as last_id,
       count(*) as updated
from upd;

-- Coverage of the active catalog (the listing only ever shows active rows).
select count(*) as active_total,
       count(country_code) as active_resolved,
       round(100.0 * count(country_code) / nullif(count(*), 0), 2) as resolved_pct
from public.jobs_v3
where is_active;

select continent,
       count(*) as jobs
from public.jobs_v3
where is_active
group by continent
order by jobs desc;

-- Top unresolved `region` strings. Add the biggest ones to
-- `public.job_country_taxonomy` (kind='city') and re-run.
select coalesce(nullif(btrim(region), ''), '(empty)') as region,
       count(*) as jobs
from public.jobs_v3
where is_active
  and country_code is null
group by 1
order by jobs desc
limit 25;
