-- Phase 4 / R18: v3 listing projection for the shadow-read flag.
-- The API's listing path uses jobs_listing for its indexed projection. Keep the
-- same shape over jobs_v3; the default remains jobs_listing until
-- JOBS_READ_SOURCE=v3 is explicitly set.
create or replace view public.jobs_listing_v3 as
select
  v.*,
  public.ai_match_region_scope(v.region::text) as region_market,
  case
    when public.ai_match_region_scope(v.region::text) = any (array['us'::text, 'canada'::text])
      then 'north_america'::text
    else public.ai_match_region_scope(v.region::text)
  end as region_group
from public.jobs_v3 v;

grant select on public.jobs_listing_v3 to anon, authenticated;
notify pgrst, 'reload schema';