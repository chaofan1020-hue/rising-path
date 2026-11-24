-- S01: job-board ingestion fields (additive, no lifecycle change)
set statement_timeout = 0;

alter table public.jobs
  add column if not exists source_key varchar(120),
  add column if not exists first_seen_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists detail_fetched_at timestamptz,
  add column if not exists display_status varchar(20) not null default 'listed',
  add column if not exists source_tier char(1) not null default 'B',
  add column if not exists dedupe_group_id text;

create index if not exists jobs_last_seen_active_idx
  on public.jobs(last_seen_at) where is_active = true;
create index if not exists jobs_dedupe_group_idx
  on public.jobs(dedupe_group_id) where dedupe_group_id is not null;
create index if not exists jobs_source_key_idx
  on public.jobs(source_key) where source_key is not null;

-- Backfill only the new columns. Never touch is_active/is_closed.
update public.jobs
set first_seen_at = coalesce(first_seen_at, created_at),
    last_seen_at = now(),
    display_status = case
      when description is not null and length(btrim(description)) > 0 then 'enriched'
      else 'listed'
    end
where is_active = true
  and (first_seen_at is null or last_seen_at is null or display_status is null);

comment on column public.jobs.source_key is 'ATS board key vendor:token; null for legacy collector rows';
comment on column public.jobs.first_seen_at is 'first observation; preserved on upsert';
comment on column public.jobs.last_seen_at is 'last observation; day-granular heartbeat';
comment on column public.jobs.display_status is 'listed|enriched|stale|manual_hold';
comment on column public.jobs.source_tier is 'S/A/B/C polling tier';