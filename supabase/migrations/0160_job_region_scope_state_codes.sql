begin;

-- Region recognition was too narrow: `job_region_matches_target()` (the stored
-- `matches_target_region` flag) and `ai_match_region_scope()` (the `region_market`
-- column of `jobs_listing_v3`, plus the `job_ai_match_scopes` table) only knew
-- country names and a fixed city whitelist. ATS postings mostly arrive as
-- "City, ST" (e.g. `Bastrop, TX`, `Phoenix, AZ`) or with trailing noise
-- (`Boise, ID - ID1`, `US-CT-EAST HARTFORD-ETC ~ 400 Main St`), so ~73k active
-- US postings were invisible in the default catalog and in region filters.
--
-- This migration:
--   1. widens `ai_match_region_scope()` with US state/territory codes, accent
--      folding and noise tolerance, while keeping non-target regions (India,
--      continental Europe, Israel, ...) unmapped;
--   2. makes `job_region_matches_target()` a superset of the old keyword list,
--      so no row that was previously visible becomes invisible.
--
-- Backfill of existing rows is NOT part of this migration; run
-- `scripts/jobs-region-backfill.sql` afterwards (it recomputes the flag through
-- the `jobs_sync_matches_target_region` trigger, which also mirrors to
-- `jobs_v3` through the shadow triggers).
--
-- Rollback: see the two original definitions at the bottom of this file.

set local statement_timeout = '60s';

-- Unambiguous US state/territory codes: codes that are not also ISO-3166-1
-- alpha-2 country codes. Ambiguous ones (AL, AR, AZ, CA, CO, DE, GA, ID, IL,
-- LA, MA, MD, MO, MT, NE, PA, SC, SD, TN, VA) are handled separately below.
create or replace function public.ai_match_region_scope(value text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $function$
  with n as (
    select translate(lower(coalesce(value, '')),
                     'àáâãäåéèêëíìîïóòôõöúùûüçñ',
                     'aaaaaaeeeeiiiiooooouuuucn') as v
  )
  select case
    -- 0) A non-target country leading the string wins over city names that may
    --    appear later ("France > Rungis : Miami Building" is not a US role).
    when v ~* '^(france|germany|netherlands|belgium|spain|italy|poland|portugal|ireland|austria|switzerland|sweden|denmark|norway|finland|czech|hungary|romania|greece|israel|india|china|japan|korea|taiwan|indonesia|malaysia|philippines|vietnam|thailand|turkey|egypt|uae|saudi|brazil|mexico|argentina|colombia|chile|peru|nigeria|kenya|pakistan|bangladesh|south africa|russia|ukraine)\s*[>:]' then null
    -- 1) Unambiguous US state/territory codes, but not when they are followed by
    --    another two-letter segment and a country code ("Nieuwegein, UT, nl").
    when v ~* ',\s*(ak|ct|dc|fl|hi|ia|ks|ky|me|mi|mn|nc|nd|nh|nj|nm|nv|ny|oh|ok|or|ri|tx|ut|vt|wa|wi|wv|wy|pr|gu|vi|as|mp)([^a-z]|$)'
      and v !~* '[^,]{3,},\s*[a-z]{2}\s*,\s*(nl|de|fr|es|it|pl|cn|jp|kr|tw|my|th|vn|id|ph|br|mx|cl|pe|ie|pt|gr|cz|hu|ro|ua|ru|tr|ae|sa|qa|eg|ng|ke|pk|bd|lk|np|se|no|dk|fi|be|ch|at)([^a-z]|$)'
      then 'us'
    -- 2) Explicit US / North America markers.
    when v ~* '(united states|united states of america|(^|[^a-z])(usa|u\.?s\.?)([^a-z]|$)|(^|[^a-z])us([^a-z]|$)|north america|americas|(^|[^a-z])anz([^a-z]|$))' then 'us'
    -- 3) US city whitelist carried over from the original definition.
    when v ~* '(new york|san francisco|los angeles|seattle|chicago|boston|austin|dallas|houston|atlanta|denver|miami|philadelphia|washington|jersey city|newark|palo alto|mountain view|arlington|raleigh|charlotte|tampa|orlando|columbus|wilmington|fort lauderdale|milwaukee|colorado springs|baton rouge|fresno|san antonio|jacksonville|san diego|remote - us)' then 'us'
    -- 4) Ambiguous US state codes: require a real city segment, and reject rows
    --    that carry a non-target country or city marker.
    when v ~* '[^,]{3,},\s*(al|az|ar|ca|co|de|ga|id|il|la|ma|md|mo|mt|ne|pa|sc|sd|tn|va)([^a-z]|$)'
      and v !~* '(india|bangalore|bengaluru|hyderabad|pune|mumbai|chennai|delhi|kolkata|gurgaon|gurugram|noida|ahmedabad|lucknow|jaipur|indore|chandigarh|kochi|coimbatore|nagpur|surat|vadodara|visakhapatnam|bhopal|mysore|mysuru|trivandrum|germany|berlin|munich|munchen|frankfurt|hamburg|dusseldorf|cologne|stuttgart|netherlands|amsterdam|rotterdam|utrecht|eindhoven|france|paris|lyon|toulouse|nantes|spain|madrid|barcelona|valencia|italy|milan|rome|turin|poland|warsaw|krakow|israel|tel aviv|haifa|jerusalem|brazil|sao paulo|rio de janeiro|mexico|guadalajara|monterrey|china|shanghai|beijing|shenzhen|guangzhou|hangzhou|japan|tokyo|osaka|korea|seoul|taiwan|taipei|indonesia|jakarta|malaysia|kuala lumpur|philippines|manila|vietnam|hanoi|thailand|bangkok|uae|dubai|abu dhabi|saudi|riyadh|qatar|doha|egypt|cairo|turkey|istanbul|ankara|south africa|johannesburg|cape town|nigeria|lagos|kenya|nairobi|pakistan|lahore|karachi|bangladesh|dhaka|sri lanka|colombo|nepal|kathmandu|austria|vienna|switzerland|zurich|geneva|sweden|stockholm|denmark|copenhagen|norway|oslo|finland|helsinki|belgium|brussels|ireland|dublin|portugal|lisbon|greece|athens|czech|prague|hungary|budapest|romania|bucharest|ukraine|kyiv|russia|moscow|europe|georgia|tbilisi|armenia|yerevan|azerbaijan|baku|moldova|chisinau|malta|valletta|macau|niger|niamey|panama|sudan|khartoum|tunisia|tunis|seychelles|vatican|albania|tirana|gabon|libreville|canada|toronto|vancouver|ottawa|montreal|mississauga|quebec|waterloo|kitchener|calgary|edmonton|winnipeg|halifax|oakville|markham|burnaby|richmond hill|gatineau|sherbrooke|saskatoon|regina|kelowna|londonderry)'
      and v !~* '[^,]{3,},\s*[a-z]{2}\s*,\s*(nl|de|fr|es|it|pl|cn|jp|kr|tw|my|th|vn|id|ph|br|mx|cl|pe|ie|pt|gr|cz|hu|ro|ua|ru|tr|ae|sa|qa|eg|ng|ke|pk|bd|lk|np|se|no|dk|fi|be|ch|at)([^a-z]|$)'
      then 'us'
    when v ~* '(canada|toronto|vancouver|ottawa|montreal|mississauga|quebec|waterloo|kitchener|calgary|edmonton|winnipeg|halifax|oakville|markham|burnaby)' then 'canada'
    when v ~* '(united kingdom|(^|[^a-z])u\.?k\.?([^a-z]|$)|england|scotland|wales|northern ireland|london|bournemouth|bristol|manchester|edinburgh|glasgow|birmingham|leeds|cardiff|belfast|cambridge|oxford|southampton|reading|guildford|crawley|aberdeen|newcastle|sheffield|liverpool|(^|[^a-z])gb([^a-z]|$))' then 'uk'
    when v ~* '(australia|sydney|melbourne|brisbane|perth|adelaide|canberra|ballarat)' then 'australia'
    when v ~* '(hong kong|kowloon)' then 'hong_kong'
    when v ~* 'singapore' then 'singapore'
    else null
  end
  from n;
$function$;

-- The stored `matches_target_region` flag must never shrink: keep the original
-- keyword list and treat any mapped region scope as a target region too.
create or replace function public.job_region_matches_target(region text)
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $function$
  select coalesce(region, '') ilike any (array[
    '%North America%', '%North-American%', '%NorthAmerican%', '%Americas%',
    '%United States%', '%USA%', '%U.S.%', '%Canada%',
    '%New York%', '%San Francisco%', '%Los Angeles%', '%Seattle%', '%Chicago%',
    '%Boston%', '%Austin%', '%Dallas%', '%Houston%', '%Atlanta%', '%Denver%',
    '%Miami%', '%Philadelphia%', '%Washington%', '%Jersey City%', '%Newark%',
    '%Palo Alto%', '%Mountain View%', '%Arlington%', '%Raleigh%', '%Charlotte%',
    '%Tampa%', '%Orlando%', '%Columbus%', '%Wilmington%', '%Fort Lauderdale%',
    '%Milwaukee%', '%Colorado Springs%', '%Baton Rouge%', '%Fresno%',
    '%San Antonio%', '%Jacksonville%', '%San Diego%', '%Toronto%', '%Vancouver%',
    '%Ottawa%', '%Montreal%', '%Mississauga%', '%Quebec%',
    '%Australia%', '%ANZ%', '%Sydney%', '%Melbourne%', '%Brisbane%', '%Perth%',
    '%Adelaide%', '%Canberra%', '%Ballarat%',
    '%Hong Kong%', '%Kowloon%', '%Hong Kong Island%', '%Singapore%',
    '%United Kingdom%', '%UK%', '%U.K.%', '%England%', '%Scotland%', '%Wales%',
    '%Northern Ireland%', '%London%', '%Bournemouth%', '%Bristol%', '%Manchester%',
    '%Edinburgh%', '%Glasgow%', '%Birmingham%', '%Leeds%', '%Cardiff%', '%Belfast%',
    '%Cambridge%', '%Oxford%', '%Southampton%', '%Reading%', '%Guildford%',
    '%Crawley%', '%Aberdeen%', '%Newcastle%', '%Sheffield%', '%Liverpool%'
  ])
  or public.ai_match_region_scope(region) is not null;
$function$;

commit;

-- ---------------------------------------------------------------------------
-- Rollback (restore the pre-0160 definitions; then re-run the backfill so the
-- stored `matches_target_region` values shrink back):
--
-- create or replace function public.ai_match_region_scope(value text)
-- returns text language sql immutable parallel safe set search_path = public
-- as $function$
--   select case
--     when coalesce(value, '') ~* '(united states|united states of america|(^|[^a-z])(usa|u\.?s\.?)([^a-z]|$)|(^|[^a-z])us([^a-z]|$)|new york|san francisco|los angeles|seattle|chicago|boston|austin|dallas|houston|atlanta|denver|miami|philadelphia|washington|jersey city|newark|palo alto|mountain view|arlington|raleigh|charlotte|tampa|orlando|columbus|wilmington|fort lauderdale|milwaukee|colorado springs|baton rouge|fresno|san antonio|jacksonville|san diego|remote - us)' then 'us'
--     when coalesce(value, '') ~* '(canada|toronto|vancouver|ottawa|montreal|mississauga|quebec)' then 'canada'
--     when coalesce(value, '') ~* '(united kingdom|(^|[^a-z])u\.?k\.?([^a-z]|$)|england|scotland|wales|northern ireland|london|bournemouth|bristol|manchester|edinburgh|glasgow|birmingham|leeds|cardiff|belfast|cambridge|oxford|southampton|reading|guildford|crawley|aberdeen|newcastle|sheffield|liverpool|(^|[^a-z])gb([^a-z]|$))' then 'uk'
--     when coalesce(value, '') ~* '(australia|sydney|melbourne|brisbane|perth|adelaide|canberra|ballarat|(^|[^a-z])au([^a-z]|$))' then 'australia'
--     when coalesce(value, '') ~* '(hong kong|kowloon|hong kong island)' then 'hong_kong'
--     when coalesce(value, '') ~* '(singapore)' then 'singapore'
--     else null
--   end;
-- $function$;
--
-- create or replace function public.job_region_matches_target(region text)
-- returns boolean language sql immutable parallel safe set search_path = public
-- as $function$
--   select coalesce(region, '') ilike any (array[ ... pre-0160 keyword list without the scope clause ... ]);
-- $function$;
-- ---------------------------------------------------------------------------