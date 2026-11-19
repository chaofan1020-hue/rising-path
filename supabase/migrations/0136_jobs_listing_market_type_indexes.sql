begin;

-- 0136_jobs_listing_market_type_indexes
--
-- Market + job-type is the most common filter combination. With only the
-- single-column indexes Postgres used one of them and re-checked the other
-- predicate on the heap row (the market is a computed expression), which cost
-- around 1.3s per request. A composite index keeps both predicates inside the
-- index and preserves the feed ordering.

set local statement_timeout = '300s';
set local lock_timeout = '15s';

create index if not exists jobs_active_market_type_feed_idx
  on public.jobs (
    public.ai_match_region_scope(region),
    job_type,
    updated_at desc nulls last,
    created_at desc,
    id desc
  )
  where is_active;

create index if not exists jobs_active_region_group_type_feed_idx
  on public.jobs (
    (
      case
        when public.ai_match_region_scope(region) in ('us', 'canada') then 'north_america'
        else public.ai_match_region_scope(region)
      end
    ),
    job_type,
    updated_at desc nulls last,
    created_at desc,
    id desc
  )
  where is_active;

analyze public.jobs;

notify pgrst, 'reload schema';

commit;
