-- S02: additive feed v2 fields needed by the downstream client.
alter table public.jobs
  add column if not exists apply_url text,
  add column if not exists source_updated_at timestamptz,
  add column if not exists snapshot_id text,
  add column if not exists is_list_only boolean not null default false;

comment on column public.jobs.apply_url is 'official apply URL when the feed provides one';
comment on column public.jobs.source_updated_at is 'upstream source last-change timestamp';
comment on column public.jobs.snapshot_id is 'upstream board snapshot identifier';
comment on column public.jobs.is_list_only is 'true when only list fields were ingested';

create index if not exists jobs_active_display_status_idx
  on public.jobs(display_status) where is_active;

-- The 0134 view expanded jobs.* at creation time, so new columns are not
-- visible until the view is recreated. CREATE OR REPLACE cannot insert columns
-- in the middle, so drop and recreate with the same shape and grants.
drop view if exists public.jobs_listing;
create view public.jobs_listing
with (security_invoker = true)
as
  select
    jobs.*,
    public.ai_match_region_scope(jobs.region) as region_market,
    case
      when public.ai_match_region_scope(jobs.region) in ('us', 'canada') then 'north_america'
      else public.ai_match_region_scope(jobs.region)
    end as region_group
  from public.jobs;

revoke all on public.jobs_listing from public;
grant select on public.jobs_listing to anon, authenticated, service_role;