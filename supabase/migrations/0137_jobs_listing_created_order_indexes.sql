begin;

-- 0137_jobs_listing_created_order_indexes
--
-- The listing API also supports the non-diverse order (`created_at desc,
-- id desc`) used by admin pickers and search results. The market/type/
-- sponsorship indexes added in 0134/0136 only order by `updated_at`, so those
-- requests fell back to scanning and sorting the whole market slice and hit
-- Supabase's statement timeout. These twins keep every supported filter on an
-- ordered index.

set local statement_timeout = '300s';
set local lock_timeout = '15s';

create index if not exists jobs_active_market_created_idx
  on public.jobs (public.ai_match_region_scope(region), created_at desc, id desc)
  where is_active;

create index if not exists jobs_active_region_group_created_idx
  on public.jobs (
    (
      case
        when public.ai_match_region_scope(region) in ('us', 'canada') then 'north_america'
        else public.ai_match_region_scope(region)
      end
    ),
    created_at desc,
    id desc
  )
  where is_active;

create index if not exists jobs_active_job_type_created_idx
  on public.jobs (job_type, created_at desc, id desc)
  where is_active;

create index if not exists jobs_active_sponsorship_created_idx
  on public.jobs (sponsorship, created_at desc, id desc)
  where is_active and sponsorship in ('yes', 'no');

analyze public.jobs;

notify pgrst, 'reload schema';

commit;
