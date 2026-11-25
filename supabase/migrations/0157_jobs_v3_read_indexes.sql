-- Phase 4 / R18 follow-up: give jobs_v3 the read-path indexes that make
-- jobs_listing fast.
--
-- 2026-11-25 measurement (production, service-role, `Prefer: count=exact`):
--   jobs_listing    ?is_active=eq.true&region_market=eq.us  ->  ~75 ms
--   jobs_listing_v3 ?is_active=eq.true&region_market=eq.us  ->  ~930 ms
-- The 12x gap is not v3 row shape; it is that jobs carries the whole
-- expression-index family (`ai_match_region_scope(region)`, region_group,
-- created_at/updated_at ordering, target-region partials, trgm search) while
-- jobs_v3 only had pkey / company / display_status / region / search.
-- Switching reads before mirroring these would make the catalog slower and
-- would risk statement timeouts on the first filter change, so they must land
-- before JOBS_READ_SOURCE=v3.
--
-- Note: on the live server these were created with CONCURRENTLY (the shadow
-- triggers write jobs_v3 inside the feed transaction, and a plain CREATE INDEX
-- would block those writes). This file uses the plain form so a fresh restore
-- can apply it in one transaction; `if not exists` makes it a no-op where the
-- concurrent build already ran.

create index if not exists jobs_v3_active_created_idx
  on public.jobs_v3 (created_at desc) where is_active;

create index if not exists jobs_v3_active_updated_created_id_idx
  on public.jobs_v3 (updated_at desc nulls last, created_at desc, id desc) where is_active;

create index if not exists jobs_v3_active_posted_at_idx
  on public.jobs_v3 (posted_at desc) where (is_active and posted_at is not null);

create index if not exists jobs_v3_active_market_created_idx
  on public.jobs_v3 (public.ai_match_region_scope(region::text), created_at desc, id desc) where is_active;

create index if not exists jobs_v3_active_market_feed_idx
  on public.jobs_v3 (public.ai_match_region_scope(region::text), updated_at desc nulls last, created_at desc, id desc) where is_active;

create index if not exists jobs_v3_active_market_type_feed_idx
  on public.jobs_v3 (public.ai_match_region_scope(region::text), job_type, updated_at desc nulls last, created_at desc, id desc) where is_active;

create index if not exists jobs_v3_active_region_group_created_idx
  on public.jobs_v3 ((case
      when public.ai_match_region_scope(region::text) = any (array['us'::text, 'canada'::text])
        then 'north_america'::text
      else public.ai_match_region_scope(region::text)
    end), created_at desc, id desc) where is_active;

create index if not exists jobs_v3_active_region_group_feed_idx
  on public.jobs_v3 ((case
      when public.ai_match_region_scope(region::text) = any (array['us'::text, 'canada'::text])
        then 'north_america'::text
      else public.ai_match_region_scope(region::text)
    end), updated_at desc nulls last, created_at desc, id desc) where is_active;

create index if not exists jobs_v3_target_active_created_idx
  on public.jobs_v3 (created_at desc, id desc) where (is_active and matches_target_region);

create index if not exists jobs_v3_target_active_feed_idx
  on public.jobs_v3 (updated_at desc nulls last, created_at desc, id desc) where (is_active and matches_target_region);

create index if not exists jobs_v3_active_job_type_created_idx
  on public.jobs_v3 (job_type, created_at desc, id desc) where is_active;

create index if not exists jobs_v3_active_job_type_feed_idx
  on public.jobs_v3 (job_type, updated_at desc nulls last, created_at desc, id desc) where is_active;

create index if not exists jobs_v3_active_sponsorship_created_idx
  on public.jobs_v3 (sponsorship, created_at desc, id desc)
  where (is_active and sponsorship::text = any (array['yes'::text, 'no'::text]));

create index if not exists jobs_v3_active_sponsorship_feed_idx
  on public.jobs_v3 (sponsorship, updated_at desc nulls last, created_at desc, id desc)
  where (is_active and sponsorship::text = any (array['yes'::text, 'no'::text]));

create index if not exists jobs_v3_active_title_trgm_idx
  on public.jobs_v3 using gin (title gin_trgm_ops) where is_active;

create index if not exists jobs_v3_active_company_trgm_idx
  on public.jobs_v3 using gin (company gin_trgm_ops) where is_active;

create index if not exists jobs_v3_active_company_created_idx
  on public.jobs_v3 (company, created_at desc) where is_active;

create index if not exists jobs_v3_direction_active_idx
  on public.jobs_v3 (direction) where is_active;

create index if not exists jobs_v3_region_plain_active_idx
  on public.jobs_v3 (region) where is_active;

create index if not exists jobs_v3_audience_active_idx
  on public.jobs_v3 (audience) where is_active;

create index if not exists jobs_v3_workplace_type_idx
  on public.jobs_v3 (workplace_type) where (is_active and workplace_type is not null);

create index if not exists jobs_v3_employment_type_idx
  on public.jobs_v3 (employment_type) where (is_active and employment_type is not null);

create index if not exists jobs_v3_employment_category_idx
  on public.jobs_v3 (employment_category) where (is_active and employment_category is not null);

create index if not exists jobs_v3_experience_min_idx
  on public.jobs_v3 (experience_min_years) where (is_active and experience_min_years is not null);

create index if not exists jobs_v3_valid_through_idx
  on public.jobs_v3 (valid_through) where (is_active and valid_through is not null);

create index if not exists jobs_v3_source_key_idx
  on public.jobs_v3 (source_key) where (source_key is not null);

create index if not exists jobs_v3_job_url_idx
  on public.jobs_v3 (job_url);

create index if not exists jobs_v3_collector_company_active_idx
  on public.jobs_v3 (source_system, company, is_active);

create index if not exists jobs_v3_collector_active_id_idx
  on public.jobs_v3 (id) include (company, job_url)
  where (is_active and source_system::text = 'collector_feed'::text and job_url is not null);

create index if not exists jobs_v3_feed_company_active_idx
  on public.jobs_v3 (company, is_active) where (source_system::text = 'collector_feed'::text);

create index if not exists jobs_v3_source_active_verified_idx
  on public.jobs_v3 (source_system, is_active, last_verified_at);

create index if not exists jobs_v3_last_seen_active_idx
  on public.jobs_v3 (last_seen_at) where is_active;

analyze public.jobs_v3;
notify pgrst, 'reload schema';