
begin;

-- D4 (docs/job-acquisition-plan-v3.md): country / continent dimension.
--
-- Before the region switch every non-target posting was dropped at ingestion,
-- so `region` was only ever a target-market string. With
-- `JOBS_FEED_REGION_FILTER=all` the catalog holds every ATS posting and the
-- listing must filter by real geography.
--
-- `region` alone cannot carry that: the feed emits `City, ST`, `City, Country`,
-- `City (FR)`, `City, Region, Country`, Workday codes like
-- `US-CT-EAST HARTFORD...`, `Remote - Canada`, `Greater Seattle Area`, and a
-- long tail of street addresses. This migration adds
--
--   * `public.job_country_taxonomy` - seeded country / alias / city / state
--     lookup. `kind` disambiguates real collisions: `georgia` is a US state and
--     a country, `in` is Indiana and India's ISO-2 code;
--   * `public.job_location_normalize(text)` - accent / period / whitespace fold;
--   * `public.job_country_code(text)` - the ordered resolver (see the tier
--     comments in the body);
--   * `public.job_region_continent(text)` - continent-only fallback for
--     continent-level regions ("North America", "Asia Pacific") and for postings
--     that are remote but still tied to a continent;
--   * `country_code` / `continent` on `public.jobs_v3` (read table) ONLY. The
--     shadow trigger (0149) copies `jobs` rows with a POSITIONAL
--     `insert into jobs_v3 select n.*, lane, closure_evidence`, so adding a
--     column to `jobs` would shift every trailing v3 column by one and silently
--     break all shadow writes (the handler only raises a warning). Adding them
--     to v3 alone keeps that insert valid - the new columns trail
--     `canonical_job_id` and the BEFORE trigger fills them. `public.jobs` gets
--     them in C2, together with the explicit-column shadow rewrite;
--   * `public.jobs_listing_v3` re-created so the new columns are exposed;
--   * two partial indexes for the listing filters;
--   * `jobs_sync_country_code` BEFORE INSERT OR UPDATE OF region trigger (v3).
--
-- Backfill is separate (`scripts/jobs-country-backfill.sql`).
-- Re-running this file is safe: every statement is idempotent.
--
-- Rollback:
--   drop trigger if exists jobs_sync_country_code on public.jobs_v3;
--   drop function if exists public.jobs_sync_country_code();
--   drop function if exists public.job_country_code(text);
--   drop function if exists public.job_region_continent(text);
--   drop function if exists public.job_location_normalize(text);
--   drop index if exists public.jobs_v3_country_active_idx;
--   drop index if exists public.jobs_v3_continent_active_idx;
--   alter table public.jobs_v3 drop column if exists country_code;
--   alter table public.jobs_v3 drop column if exists continent;
--   -- recreate `jobs_listing_v3` from migration 0151 (its `select v.*` shape);
--   drop table if exists public.job_country_taxonomy;

set local statement_timeout = '120s';

create table if not exists public.job_country_taxonomy (
  token text not null,
  kind text not null check (kind in ('country', 'country_iso', 'alias', 'city', 'state')),
  country_code char(2) not null,
  country_name text not null,
  continent text not null check (continent in
    ('north_america', 'south_america', 'europe', 'asia', 'africa', 'oceania')),
  priority smallint not null,
  primary key (token, kind)
);

comment on table public.job_country_taxonomy is
  'D4 country resolver lookup: token -> country_code/continent; kind disambiguates city/state/country collisions';

-- The seed below is the whole table: drop whatever a previous run left behind so
-- a re-applied migration never keeps stale tokens. Add new places to the seed
-- here (or in a follow-up migration) rather than by hand in production.
delete from public.job_country_taxonomy;

insert into public.job_country_taxonomy (token, kind, country_code, country_name, continent, priority)
values
  ('a coruna', 'city', 'ES', 'spain', 'europe', 3),
  ('a coruña', 'city', 'ES', 'spain', 'europe', 3),
  ('aach', 'city', 'DE', 'germany', 'europe', 3),
  ('aachen', 'city', 'DE', 'germany', 'europe', 3),
  ('aalborg', 'city', 'DK', 'denmark', 'europe', 3),
  ('aarhus', 'city', 'DK', 'denmark', 'europe', 3),
  ('ab,ca', 'state', 'CA', 'canada', 'north_america', 5),
  ('abbotsford', 'city', 'CA', 'canada', 'north_america', 3),
  ('aberdeen', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('abu dhabi', 'city', 'AE', 'united arab emirates', 'asia', 3),
  ('abuja', 'city', 'NG', 'nigeria', 'africa', 3),
  ('accra', 'city', 'GH', 'ghana', 'africa', 3),
  ('act,au', 'state', 'AU', 'australia', 'oceania', 5),
  ('ad', 'country_iso', 'AD', 'andorra', 'europe', 2),
  ('addis ababa', 'city', 'ET', 'ethiopia', 'africa', 3),
  ('adelaide', 'city', 'AU', 'australia', 'oceania', 3),
  ('ae', 'country_iso', 'AE', 'united arab emirates', 'asia', 2),
  ('af', 'country_iso', 'AF', 'afghanistan', 'asia', 2),
  ('afghanistan', 'country', 'AF', 'afghanistan', 'asia', 1),
  ('ahmedabad', 'city', 'IN', 'india', 'asia', 3),
  ('aichi', 'city', 'JP', 'japan', 'asia', 3),
  ('aichi prefecture', 'city', 'JP', 'japan', 'asia', 3),
  ('aix-en-provence', 'city', 'FR', 'france', 'europe', 3),
  ('ak,us', 'state', 'US', 'united states', 'north_america', 5),
  ('al', 'country_iso', 'AL', 'albania', 'europe', 2),
  ('al,us', 'state', 'US', 'united states', 'north_america', 5),
  ('alabama,us', 'state', 'US', 'united states', 'north_america', 4),
  ('alaska,us', 'state', 'US', 'united states', 'north_america', 4),
  ('albania', 'country', 'AL', 'albania', 'europe', 1),
  ('albany', 'city', 'US', 'united states', 'north_america', 3),
  ('alberta,ca', 'state', 'CA', 'canada', 'north_america', 4),
  ('albuquerque', 'city', 'US', 'united states', 'north_america', 3),
  ('alexandria', 'city', 'EG', 'egypt', 'africa', 3),
  ('algeria', 'country', 'DZ', 'algeria', 'africa', 1),
  ('alicante', 'city', 'ES', 'spain', 'europe', 3),
  ('almaty', 'city', 'KZ', 'kazakhstan', 'asia', 3),
  ('almere', 'city', 'NL', 'netherlands', 'europe', 3),
  ('alphaville', 'city', 'BR', 'brazil', 'south_america', 3),
  ('am', 'country_iso', 'AM', 'armenia', 'asia', 2),
  ('amarillo', 'city', 'US', 'united states', 'north_america', 3),
  ('american samoa,us', 'state', 'US', 'united states', 'north_america', 4),
  ('amersfoort', 'city', 'NL', 'netherlands', 'europe', 3),
  ('amman', 'city', 'JO', 'jordan', 'asia', 3),
  ('amsterdam', 'city', 'NL', 'netherlands', 'europe', 3),
  ('anaheim', 'city', 'US', 'united states', 'north_america', 3),
  ('ancarano', 'city', 'IT', 'italy', 'europe', 3),
  ('anchorage', 'city', 'US', 'united states', 'north_america', 3),
  ('ancona', 'city', 'IT', 'italy', 'europe', 3),
  ('andorra', 'country', 'AD', 'andorra', 'europe', 1),
  ('angers', 'city', 'FR', 'france', 'europe', 3),
  ('angola', 'country', 'AO', 'angola', 'africa', 1),
  ('ankara', 'city', 'TR', 'turkey', 'asia', 3),
  ('ann arbor', 'city', 'US', 'united states', 'north_america', 3),
  ('ansbach', 'city', 'DE', 'germany', 'europe', 3),
  ('antalya', 'city', 'TR', 'turkey', 'asia', 3),
  ('antioquia', 'city', 'CO', 'colombia', 'south_america', 3),
  ('antwerp', 'city', 'BE', 'belgium', 'europe', 3),
  ('antwerpen', 'city', 'BE', 'belgium', 'europe', 3),
  ('ao', 'country_iso', 'AO', 'angola', 'africa', 2),
  ('apeldoorn', 'city', 'NL', 'netherlands', 'europe', 3),
  ('ar', 'country_iso', 'AR', 'argentina', 'south_america', 2),
  ('ar,us', 'state', 'US', 'united states', 'north_america', 5),
  ('arequipa', 'city', 'PE', 'peru', 'south_america', 3),
  ('argentina', 'country', 'AR', 'argentina', 'south_america', 1),
  ('arizona,us', 'state', 'US', 'united states', 'north_america', 4),
  ('arkansas,us', 'state', 'US', 'united states', 'north_america', 4),
  ('arlington', 'city', 'US', 'united states', 'north_america', 3),
  ('arlington tx', 'city', 'US', 'united states', 'north_america', 3),
  ('armenia', 'country', 'AM', 'armenia', 'asia', 1),
  ('arnhem', 'city', 'NL', 'netherlands', 'europe', 3),
  ('as,us', 'state', 'US', 'united states', 'north_america', 5),
  ('ascoli piceno', 'city', 'IT', 'italy', 'europe', 3),
  ('asheville', 'city', 'US', 'united states', 'north_america', 3),
  ('astana', 'city', 'KZ', 'kazakhstan', 'asia', 3),
  ('at', 'country_iso', 'AT', 'austria', 'europe', 2),
  ('athens', 'city', 'GR', 'greece', 'europe', 3),
  ('athina', 'city', 'GR', 'greece', 'europe', 3),
  ('atlanta', 'city', 'US', 'united states', 'north_america', 3),
  ('au', 'country_iso', 'AU', 'australia', 'oceania', 2),
  ('auckland', 'city', 'NZ', 'new zealand', 'oceania', 3),
  ('augsburg', 'city', 'DE', 'germany', 'europe', 3),
  ('austin', 'city', 'US', 'united states', 'north_america', 3),
  ('australia', 'country', 'AU', 'australia', 'oceania', 1),
  ('australian capital territory,au', 'state', 'AU', 'australia', 'oceania', 4),
  ('austria', 'country', 'AT', 'austria', 'europe', 1),
  ('aveiro', 'city', 'PT', 'portugal', 'europe', 3),
  ('avignon', 'city', 'FR', 'france', 'europe', 3),
  ('az', 'country_iso', 'AZ', 'azerbaijan', 'asia', 2),
  ('az,us', 'state', 'US', 'united states', 'north_america', 5),
  ('azerbaijan', 'country', 'AZ', 'azerbaijan', 'asia', 1),
  ('ba', 'country_iso', 'BA', 'bosnia and herzegovina', 'europe', 2),
  ('bad homburg', 'city', 'DE', 'germany', 'europe', 3),
  ('bad kissingen', 'city', 'DE', 'germany', 'europe', 3),
  ('bahamas', 'country', 'BS', 'bahamas', 'north_america', 1),
  ('bahrain', 'country', 'BH', 'bahrain', 'asia', 1),
  ('bakersfield', 'city', 'US', 'united states', 'north_america', 3),
  ('baku', 'city', 'AZ', 'azerbaijan', 'asia', 3),
  ('bali', 'city', 'ID', 'indonesia', 'asia', 3),
  ('ballarat', 'city', 'AU', 'australia', 'oceania', 3),
  ('baltimore', 'city', 'US', 'united states', 'north_america', 3),
  ('bandung', 'city', 'ID', 'indonesia', 'asia', 3),
  ('bangalore', 'city', 'IN', 'india', 'asia', 3),
  ('bangkok', 'city', 'TH', 'thailand', 'asia', 3),
  ('bangladesh', 'country', 'BD', 'bangladesh', 'asia', 1),
  ('bangsar', 'city', 'MY', 'malaysia', 'asia', 3),
  ('bangsar south', 'city', 'MY', 'malaysia', 'asia', 3),
  ('banja luka', 'city', 'BA', 'bosnia and herzegovina', 'europe', 3),
  ('barbados', 'country', 'BB', 'barbados', 'north_america', 1),
  ('barcelona', 'city', 'ES', 'spain', 'europe', 3),
  ('bari', 'city', 'IT', 'italy', 'europe', 3),
  ('barranquilla', 'city', 'CO', 'colombia', 'south_america', 3),
  ('barrie', 'city', 'CA', 'canada', 'north_america', 3),
  ('barueri', 'city', 'BR', 'brazil', 'south_america', 3),
  ('basel', 'city', 'CH', 'switzerland', 'europe', 3),
  ('bastrop', 'city', 'US', 'united states', 'north_america', 3),
  ('bath', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('baton rouge', 'city', 'US', 'united states', 'north_america', 3),
  ('batumi', 'city', 'GE', 'georgia', 'asia', 3),
  ('bay area', 'city', 'US', 'united states', 'north_america', 3),
  ('bb', 'country_iso', 'BB', 'barbados', 'north_america', 2),
  ('bc,ca', 'state', 'CA', 'canada', 'north_america', 5),
  ('bd', 'country_iso', 'BD', 'bangladesh', 'asia', 2),
  ('be', 'country_iso', 'BE', 'belgium', 'europe', 2),
  ('be''er sheva', 'city', 'IL', 'israel', 'asia', 3),
  ('bedfordshire', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('beer sheva', 'city', 'IL', 'israel', 'asia', 3),
  ('beijing', 'city', 'CN', 'china', 'asia', 3),
  ('beirut', 'city', 'LB', 'lebanon', 'asia', 3),
  ('bekasi', 'city', 'ID', 'indonesia', 'asia', 3),
  ('belarus', 'country', 'BY', 'belarus', 'europe', 1),
  ('belfast', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('belgium', 'country', 'BE', 'belgium', 'europe', 1),
  ('belgrade', 'city', 'RS', 'serbia', 'europe', 3),
  ('belize', 'country', 'BZ', 'belize', 'north_america', 1),
  ('bellevue', 'city', 'US', 'united states', 'north_america', 3),
  ('belo horizonte', 'city', 'BR', 'brazil', 'south_america', 3),
  ('bend', 'city', 'US', 'united states', 'north_america', 3),
  ('bengaluru', 'city', 'IN', 'india', 'asia', 3),
  ('benin', 'country', 'BJ', 'benin', 'africa', 1),
  ('beograd', 'city', 'RS', 'serbia', 'europe', 3),
  ('bergamo', 'city', 'IT', 'italy', 'europe', 3),
  ('bergen', 'city', 'NO', 'norway', 'europe', 3),
  ('berkeley', 'city', 'US', 'united states', 'north_america', 3),
  ('berkshire', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('berlin', 'city', 'DE', 'germany', 'europe', 3),
  ('bern', 'city', 'CH', 'switzerland', 'europe', 3),
  ('bethesda', 'city', 'US', 'united states', 'north_america', 3),
  ('bf', 'country_iso', 'BF', 'burkina faso', 'africa', 2),
  ('bg', 'country_iso', 'BG', 'bulgaria', 'europe', 2),
  ('bh', 'country_iso', 'BH', 'bahrain', 'asia', 2),
  ('bhopal', 'city', 'IN', 'india', 'asia', 3),
  ('bhubaneswar', 'city', 'IN', 'india', 'asia', 3),
  ('bhutan', 'country', 'BT', 'bhutan', 'asia', 1),
  ('bi', 'country_iso', 'BI', 'burundi', 'africa', 2),
  ('bielefeld', 'city', 'DE', 'germany', 'europe', 3),
  ('bilbao', 'city', 'ES', 'spain', 'europe', 3),
  ('birmingham', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('bj', 'country_iso', 'BJ', 'benin', 'africa', 2),
  ('blumenau', 'city', 'BR', 'brazil', 'south_america', 3),
  ('bn', 'country_iso', 'BN', 'brunei', 'asia', 2),
  ('bo', 'country_iso', 'BO', 'bolivia', 'south_america', 2),
  ('boca raton', 'city', 'US', 'united states', 'north_america', 3),
  ('boeblingen', 'city', 'DE', 'germany', 'europe', 3),
  ('bogota', 'city', 'CO', 'colombia', 'south_america', 3),
  ('bogotá', 'city', 'CO', 'colombia', 'south_america', 3),
  ('boise', 'city', 'US', 'united states', 'north_america', 3),
  ('boise id', 'city', 'US', 'united states', 'north_america', 3),
  ('bolivia', 'country', 'BO', 'bolivia', 'south_america', 1),
  ('bologna', 'city', 'IT', 'italy', 'europe', 3),
  ('bonn', 'city', 'DE', 'germany', 'europe', 3),
  ('bordeaux', 'city', 'FR', 'france', 'europe', 3),
  ('bosnia', 'alias', 'BA', 'bosnia and herzegovina', 'europe', 2),
  ('bosnia and herzegovina', 'country', 'BA', 'bosnia and herzegovina', 'europe', 1),
  ('boston', 'city', 'US', 'united states', 'north_america', 3),
  ('botswana', 'country', 'BW', 'botswana', 'africa', 1),
  ('boulder', 'city', 'US', 'united states', 'north_america', 3),
  ('boulogne-billancourt', 'city', 'FR', 'france', 'europe', 3),
  ('bournemouth', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('bozeman', 'city', 'US', 'united states', 'north_america', 3),
  ('br', 'country_iso', 'BR', 'brazil', 'south_america', 2),
  ('bradford', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('braga', 'city', 'PT', 'portugal', 'europe', 3),
  ('brampton', 'city', 'CA', 'canada', 'north_america', 3),
  ('brasil', 'alias', 'BR', 'brazil', 'south_america', 2),
  ('brasilia', 'city', 'BR', 'brazil', 'south_america', 3),
  ('brasov', 'city', 'RO', 'romania', 'europe', 3),
  ('brasília', 'city', 'BR', 'brazil', 'south_america', 3),
  ('bratislava', 'city', 'SK', 'slovakia', 'europe', 3),
  ('braunschweig', 'city', 'DE', 'germany', 'europe', 3),
  ('brazil', 'country', 'BR', 'brazil', 'south_america', 1),
  ('brașov', 'city', 'RO', 'romania', 'europe', 3),
  ('breda', 'city', 'NL', 'netherlands', 'europe', 3),
  ('bremen', 'city', 'DE', 'germany', 'europe', 3),
  ('bremerhaven', 'city', 'DE', 'germany', 'europe', 3),
  ('brescia', 'city', 'IT', 'italy', 'europe', 3),
  ('brest', 'city', 'FR', 'france', 'europe', 3),
  ('bridgeport', 'city', 'US', 'united states', 'north_america', 3),
  ('brighton', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('brisbane', 'city', 'AU', 'australia', 'oceania', 3),
  ('bristol', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('britain', 'alias', 'GB', 'united kingdom', 'europe', 2),
  ('british columbia,ca', 'state', 'CA', 'canada', 'north_america', 4),
  ('brno', 'city', 'CZ', 'czechia', 'europe', 3),
  ('bronx', 'city', 'US', 'united states', 'north_america', 3),
  ('brooklyn', 'city', 'US', 'united states', 'north_america', 3),
  ('brossard', 'city', 'CA', 'canada', 'north_america', 3),
  ('brugge', 'city', 'BE', 'belgium', 'europe', 3),
  ('brunei', 'country', 'BN', 'brunei', 'asia', 1),
  ('brussels', 'city', 'BE', 'belgium', 'europe', 3),
  ('bruxelles', 'city', 'BE', 'belgium', 'europe', 3),
  ('bs', 'country_iso', 'BS', 'bahamas', 'north_america', 2),
  ('bt', 'country_iso', 'BT', 'bhutan', 'asia', 2),
  ('bucharest', 'city', 'RO', 'romania', 'europe', 3),
  ('buckinghamshire', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('bucuresti', 'city', 'RO', 'romania', 'europe', 3),
  ('bucurești', 'city', 'RO', 'romania', 'europe', 3),
  ('budapest', 'city', 'HU', 'hungary', 'europe', 3),
  ('buenos aires', 'city', 'AR', 'argentina', 'south_america', 3),
  ('buffalo', 'city', 'US', 'united states', 'north_america', 3),
  ('bulgaria', 'country', 'BG', 'bulgaria', 'europe', 1),
  ('burkina faso', 'country', 'BF', 'burkina faso', 'africa', 1),
  ('burma', 'alias', 'MM', 'myanmar', 'asia', 2),
  ('burnaby', 'city', 'CA', 'canada', 'north_america', 3),
  ('bursa', 'city', 'TR', 'turkey', 'asia', 3),
  ('burundi', 'country', 'BI', 'burundi', 'africa', 1),
  ('busan', 'city', 'KR', 'south korea', 'asia', 3),
  ('bw', 'country_iso', 'BW', 'botswana', 'africa', 2),
  ('by', 'country_iso', 'BY', 'belarus', 'europe', 2),
  ('bydgoszcz', 'city', 'PL', 'poland', 'europe', 3),
  ('bz', 'country_iso', 'BZ', 'belize', 'north_america', 2),
  ('böblingen', 'city', 'DE', 'germany', 'europe', 3),
  ('ca', 'country_iso', 'CA', 'canada', 'north_america', 2),
  ('ca,us', 'state', 'US', 'united states', 'north_america', 5),
  ('caen', 'city', 'FR', 'france', 'europe', 3),
  ('cagliari', 'city', 'IT', 'italy', 'europe', 3),
  ('cairns', 'city', 'AU', 'australia', 'oceania', 3),
  ('cairo', 'city', 'EG', 'egypt', 'africa', 3),
  ('calgary', 'city', 'CA', 'canada', 'north_america', 3),
  ('cali', 'city', 'CO', 'colombia', 'south_america', 3),
  ('california,us', 'state', 'US', 'united states', 'north_america', 4),
  ('cambodia', 'country', 'KH', 'cambodia', 'asia', 1),
  ('cambridge', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('cambridgeshire', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('cameroon', 'country', 'CM', 'cameroon', 'africa', 1),
  ('campinas', 'city', 'BR', 'brazil', 'south_america', 3),
  ('canada', 'country', 'CA', 'canada', 'north_america', 1),
  ('canberra', 'city', 'AU', 'australia', 'oceania', 3),
  ('cancun', 'city', 'MX', 'mexico', 'north_america', 3),
  ('cancún', 'city', 'MX', 'mexico', 'north_america', 3),
  ('cape coral', 'city', 'US', 'united states', 'north_america', 3),
  ('cape town', 'city', 'ZA', 'south africa', 'africa', 3),
  ('cardiff', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('casablanca', 'city', 'MA', 'morocco', 'africa', 3),
  ('catania', 'city', 'IT', 'italy', 'europe', 3),
  ('cd', 'country_iso', 'CD', 'democratic republic of the congo', 'africa', 2),
  ('cdmx', 'city', 'MX', 'mexico', 'north_america', 3),
  ('cebu', 'city', 'PH', 'philippines', 'asia', 3),
  ('cergy', 'city', 'FR', 'france', 'europe', 3),
  ('cergy-pontoise', 'city', 'FR', 'france', 'europe', 3),
  ('cg', 'country_iso', 'CG', 'republic of the congo', 'africa', 2),
  ('ch', 'country_iso', 'CH', 'switzerland', 'europe', 2),
  ('chad', 'country', 'TD', 'chad', 'africa', 1),
  ('chandigarh', 'city', 'IN', 'india', 'asia', 3),
  ('chandler', 'city', 'US', 'united states', 'north_america', 3),
  ('changsha', 'city', 'CN', 'china', 'asia', 3),
  ('chania', 'city', 'GR', 'greece', 'europe', 3),
  ('chapel hill', 'city', 'US', 'united states', 'north_america', 3),
  ('charleroi', 'city', 'BE', 'belgium', 'europe', 3),
  ('charleston', 'city', 'US', 'united states', 'north_america', 3),
  ('charlotte', 'city', 'US', 'united states', 'north_america', 3),
  ('charlottetown', 'city', 'CA', 'canada', 'north_america', 3),
  ('chemnitz', 'city', 'DE', 'germany', 'europe', 3),
  ('chengdu', 'city', 'CN', 'china', 'asia', 3),
  ('chennai', 'city', 'IN', 'india', 'asia', 3),
  ('chesapeake', 'city', 'US', 'united states', 'north_america', 3),
  ('cheshire', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('chester', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('chiang mai', 'city', 'TH', 'thailand', 'asia', 3),
  ('chicago', 'city', 'US', 'united states', 'north_america', 3),
  ('chile', 'country', 'CL', 'chile', 'south_america', 1),
  ('china', 'country', 'CN', 'china', 'asia', 1),
  ('chisinau', 'city', 'MD', 'moldova', 'europe', 3),
  ('chittagong', 'city', 'BD', 'bangladesh', 'asia', 3),
  ('chișinău', 'city', 'MD', 'moldova', 'europe', 3),
  ('chongqing', 'city', 'CN', 'china', 'asia', 3),
  ('christchurch', 'city', 'NZ', 'new zealand', 'oceania', 3),
  ('ci', 'country_iso', 'CI', 'ivory coast', 'africa', 2),
  ('cincinnati', 'city', 'US', 'united states', 'north_america', 3),
  ('ciudad de guatemala', 'city', 'GT', 'guatemala', 'north_america', 3),
  ('ciudad de mexico', 'city', 'MX', 'mexico', 'north_america', 3),
  ('ciudad de panama', 'city', 'PA', 'panama', 'north_america', 3),
  ('cl', 'country_iso', 'CL', 'chile', 'south_america', 2),
  ('clearwater', 'city', 'US', 'united states', 'north_america', 3),
  ('clermont-ferrand', 'city', 'FR', 'france', 'europe', 3),
  ('cleveland', 'city', 'US', 'united states', 'north_america', 3),
  ('clichy', 'city', 'FR', 'france', 'europe', 3),
  ('cluj', 'city', 'RO', 'romania', 'europe', 3),
  ('cluj-napoca', 'city', 'RO', 'romania', 'europe', 3),
  ('cm', 'country_iso', 'CM', 'cameroon', 'africa', 2),
  ('cn', 'country_iso', 'CN', 'china', 'asia', 2),
  ('co', 'country_iso', 'CO', 'colombia', 'south_america', 2),
  ('co,us', 'state', 'US', 'united states', 'north_america', 5),
  ('coimbatore', 'city', 'IN', 'india', 'asia', 3),
  ('coimbra', 'city', 'PT', 'portugal', 'europe', 3),
  ('cologne', 'city', 'DE', 'germany', 'europe', 3),
  ('colombia', 'country', 'CO', 'colombia', 'south_america', 1),
  ('colombo', 'city', 'LK', 'sri lanka', 'asia', 3),
  ('colorado springs', 'city', 'US', 'united states', 'north_america', 3),
  ('colorado,us', 'state', 'US', 'united states', 'north_america', 4),
  ('columbus', 'city', 'US', 'united states', 'north_america', 3),
  ('como', 'city', 'IT', 'italy', 'europe', 3),
  ('concepcion', 'city', 'CL', 'chile', 'south_america', 3),
  ('concepción', 'city', 'CL', 'chile', 'south_america', 3),
  ('congo', 'alias', 'CD', 'democratic republic of the congo', 'africa', 2),
  ('connecticut,us', 'state', 'US', 'united states', 'north_america', 4),
  ('copenhagen', 'city', 'DK', 'denmark', 'europe', 3),
  ('coquitlam', 'city', 'CA', 'canada', 'north_america', 3),
  ('cordoba', 'city', 'AR', 'argentina', 'south_america', 3),
  ('cork', 'city', 'IE', 'ireland', 'europe', 3),
  ('corpus christi', 'city', 'US', 'united states', 'north_america', 3),
  ('costa rica', 'country', 'CR', 'costa rica', 'north_america', 1),
  ('cote d''ivoire', 'alias', 'CI', 'ivory coast', 'africa', 2),
  ('courbevoie', 'city', 'FR', 'france', 'europe', 3),
  ('coventry', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('cr', 'country_iso', 'CR', 'costa rica', 'north_america', 2),
  ('crawley', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('croatia', 'country', 'HR', 'croatia', 'europe', 1),
  ('ct,us', 'state', 'US', 'united states', 'north_america', 5),
  ('cu', 'country_iso', 'CU', 'cuba', 'north_america', 2),
  ('cuba', 'country', 'CU', 'cuba', 'north_america', 1),
  ('cumbria', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('cupertino', 'city', 'US', 'united states', 'north_america', 3),
  ('curitiba', 'city', 'BR', 'brazil', 'south_america', 3),
  ('cy', 'country_iso', 'CY', 'cyprus', 'europe', 2),
  ('cyberjaya', 'city', 'MY', 'malaysia', 'asia', 3),
  ('cyprus', 'country', 'CY', 'cyprus', 'europe', 1),
  ('cz', 'country_iso', 'CZ', 'czechia', 'europe', 2),
  ('czech', 'alias', 'CZ', 'czechia', 'europe', 2),
  ('czech republic', 'alias', 'CZ', 'czechia', 'europe', 2),
  ('czechia', 'country', 'CZ', 'czechia', 'europe', 1),
  ('córdoba', 'city', 'AR', 'argentina', 'south_america', 3),
  ('côte d''ivoire', 'alias', 'CI', 'ivory coast', 'africa', 2),
  ('da nang', 'city', 'VN', 'vietnam', 'asia', 3),
  ('daegu', 'city', 'KR', 'south korea', 'asia', 3),
  ('daejeon', 'city', 'KR', 'south korea', 'asia', 3),
  ('dalian', 'city', 'CN', 'china', 'asia', 3),
  ('dallas', 'city', 'US', 'united states', 'north_america', 3),
  ('dammam', 'city', 'SA', 'saudi arabia', 'asia', 3),
  ('darmstadt', 'city', 'DE', 'germany', 'europe', 3),
  ('darwin', 'city', 'AU', 'australia', 'oceania', 3),
  ('davao', 'city', 'PH', 'philippines', 'asia', 3),
  ('dc,us', 'state', 'US', 'united states', 'north_america', 5),
  ('de', 'country_iso', 'DE', 'germany', 'europe', 2),
  ('de,us', 'state', 'US', 'united states', 'north_america', 5),
  ('debrecen', 'city', 'HU', 'hungary', 'europe', 3),
  ('dehradun', 'city', 'IN', 'india', 'asia', 3),
  ('delaware,us', 'state', 'US', 'united states', 'north_america', 4),
  ('delft', 'city', 'NL', 'netherlands', 'europe', 3),
  ('delhi', 'city', 'IN', 'india', 'asia', 3),
  ('democratic republic of the congo', 'country', 'CD', 'democratic republic of the congo', 'africa', 1),
  ('den haag', 'city', 'NL', 'netherlands', 'europe', 3),
  ('denmark', 'country', 'DK', 'denmark', 'europe', 1),
  ('denpasar', 'city', 'ID', 'indonesia', 'asia', 3),
  ('denver', 'city', 'US', 'united states', 'north_america', 3),
  ('derby', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('des moines', 'city', 'US', 'united states', 'north_america', 3),
  ('detmold', 'city', 'DE', 'germany', 'europe', 3),
  ('detroit', 'city', 'US', 'united states', 'north_america', 3),
  ('deutschland', 'alias', 'DE', 'germany', 'europe', 2),
  ('deventer', 'city', 'NL', 'netherlands', 'europe', 3),
  ('devon', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('dhaka', 'city', 'BD', 'bangladesh', 'asia', 3),
  ('dijon', 'city', 'FR', 'france', 'europe', 3),
  ('district of columbia,us', 'state', 'US', 'united states', 'north_america', 4),
  ('dj', 'country_iso', 'DJ', 'djibouti', 'africa', 2),
  ('djibouti', 'country', 'DJ', 'djibouti', 'africa', 1),
  ('dk', 'country_iso', 'DK', 'denmark', 'europe', 2),
  ('dnipro', 'city', 'UA', 'ukraine', 'europe', 3),
  ('do', 'country_iso', 'DO', 'dominican republic', 'north_america', 2),
  ('doha', 'city', 'QA', 'qatar', 'asia', 3),
  ('dominican republic', 'country', 'DO', 'dominican republic', 'north_america', 1),
  ('dongguan', 'city', 'CN', 'china', 'asia', 3),
  ('doral', 'city', 'US', 'united states', 'north_america', 3),
  ('dordrecht', 'city', 'NL', 'netherlands', 'europe', 3),
  ('dorset', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('dortmund', 'city', 'DE', 'germany', 'europe', 3),
  ('drc', 'alias', 'CD', 'democratic republic of the congo', 'africa', 2),
  ('dresden', 'city', 'DE', 'germany', 'europe', 3),
  ('drogheda', 'city', 'IE', 'ireland', 'europe', 3),
  ('dubai', 'city', 'AE', 'united arab emirates', 'asia', 3),
  ('dublin', 'city', 'IE', 'ireland', 'europe', 3),
  ('dundalk', 'city', 'IE', 'ireland', 'europe', 3),
  ('dundee', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('dunedin', 'city', 'NZ', 'new zealand', 'oceania', 3),
  ('durban', 'city', 'ZA', 'south africa', 'africa', 3),
  ('durham', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('dusseldorf', 'city', 'DE', 'germany', 'europe', 3),
  ('dz', 'country_iso', 'DZ', 'algeria', 'africa', 2),
  ('düsseldorf', 'city', 'DE', 'germany', 'europe', 3),
  ('east jakarta', 'city', 'ID', 'indonesia', 'asia', 3),
  ('east riding of yorkshire', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('east sussex', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('east timor', 'alias', 'TL', 'timor-leste', 'asia', 2),
  ('ec', 'country_iso', 'EC', 'ecuador', 'south_america', 2),
  ('ecuador', 'country', 'EC', 'ecuador', 'south_america', 1),
  ('edinburgh', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('edison', 'city', 'US', 'united states', 'north_america', 3),
  ('edmonton', 'city', 'CA', 'canada', 'north_america', 3),
  ('ee', 'country_iso', 'EE', 'estonia', 'europe', 2),
  ('eg', 'country_iso', 'EG', 'egypt', 'africa', 2),
  ('egypt', 'country', 'EG', 'egypt', 'africa', 1),
  ('eindhoven', 'city', 'NL', 'netherlands', 'europe', 3),
  ('eire', 'alias', 'IE', 'ireland', 'europe', 2),
  ('el paso', 'city', 'US', 'united states', 'north_america', 3),
  ('el salvador', 'country', 'SV', 'el salvador', 'north_america', 1),
  ('england', 'alias', 'GB', 'united kingdom', 'europe', 2),
  ('enschede', 'city', 'NL', 'netherlands', 'europe', 3),
  ('equatorial guinea', 'country', 'GQ', 'equatorial guinea', 'africa', 1),
  ('er', 'country_iso', 'ER', 'eritrea', 'africa', 2),
  ('erfurt', 'city', 'DE', 'germany', 'europe', 3),
  ('eritrea', 'country', 'ER', 'eritrea', 'africa', 1),
  ('erlangen', 'city', 'DE', 'germany', 'europe', 3),
  ('es', 'country_iso', 'ES', 'spain', 'europe', 2),
  ('eschborn', 'city', 'DE', 'germany', 'europe', 3),
  ('españa', 'alias', 'ES', 'spain', 'europe', 2),
  ('espoo', 'city', 'FI', 'finland', 'europe', 3),
  ('essen', 'city', 'DE', 'germany', 'europe', 3),
  ('essex', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('estonia', 'country', 'EE', 'estonia', 'europe', 1),
  ('eswatini', 'country', 'SZ', 'eswatini', 'africa', 1),
  ('et', 'country_iso', 'ET', 'ethiopia', 'africa', 2),
  ('ethiopia', 'country', 'ET', 'ethiopia', 'africa', 1),
  ('etobicoke', 'city', 'CA', 'canada', 'north_america', 3),
  ('eugene', 'city', 'US', 'united states', 'north_america', 3),
  ('evanston', 'city', 'US', 'united states', 'north_america', 3),
  ('exeter', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('falls church', 'city', 'US', 'united states', 'north_america', 3),
  ('faro', 'city', 'PT', 'portugal', 'europe', 3),
  ('fes', 'city', 'MA', 'morocco', 'africa', 3),
  ('fi', 'country_iso', 'FI', 'finland', 'europe', 2),
  ('fife', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('fiji', 'country', 'FJ', 'fiji', 'oceania', 1),
  ('finland', 'country', 'FI', 'finland', 'europe', 1),
  ('firenze', 'city', 'IT', 'italy', 'europe', 3),
  ('fj', 'country_iso', 'FJ', 'fiji', 'oceania', 2),
  ('fl,us', 'state', 'US', 'united states', 'north_america', 5),
  ('flensburg', 'city', 'DE', 'germany', 'europe', 3),
  ('florence', 'city', 'IT', 'italy', 'europe', 3),
  ('florianopolis', 'city', 'BR', 'brazil', 'south_america', 3),
  ('florianópolis', 'city', 'BR', 'brazil', 'south_america', 3),
  ('florida,us', 'state', 'US', 'united states', 'north_america', 4),
  ('fort collins', 'city', 'US', 'united states', 'north_america', 3),
  ('fort lauderdale', 'city', 'US', 'united states', 'north_america', 3),
  ('fort pierce', 'city', 'US', 'united states', 'north_america', 3),
  ('fort worth', 'city', 'US', 'united states', 'north_america', 3),
  ('fortaleza', 'city', 'BR', 'brazil', 'south_america', 3),
  ('foshan', 'city', 'CN', 'china', 'asia', 3),
  ('fr', 'country_iso', 'FR', 'france', 'europe', 2),
  ('france', 'country', 'FR', 'france', 'europe', 1),
  ('frankfurt', 'city', 'DE', 'germany', 'europe', 3),
  ('frankfurt am main', 'city', 'DE', 'germany', 'europe', 3),
  ('fredericton', 'city', 'CA', 'canada', 'north_america', 3),
  ('freiburg', 'city', 'DE', 'germany', 'europe', 3),
  ('fremont', 'city', 'US', 'united states', 'north_america', 3),
  ('french polynesia', 'country', 'PF', 'french polynesia', 'oceania', 1),
  ('fresno', 'city', 'US', 'united states', 'north_america', 3),
  ('fribourg', 'city', 'CH', 'switzerland', 'europe', 3),
  ('fukuoka', 'city', 'JP', 'japan', 'asia', 3),
  ('furth', 'city', 'DE', 'germany', 'europe', 3),
  ('fürth', 'city', 'DE', 'germany', 'europe', 3),
  ('ga', 'country_iso', 'GA', 'gabon', 'africa', 2),
  ('ga,us', 'state', 'US', 'united states', 'north_america', 5),
  ('gabon', 'country', 'GA', 'gabon', 'africa', 1),
  ('galway', 'city', 'IE', 'ireland', 'europe', 3),
  ('gambia', 'country', 'GM', 'gambia', 'africa', 1),
  ('gatineau', 'city', 'CA', 'canada', 'north_america', 3),
  ('gb', 'alias', 'GB', 'united kingdom', 'europe', 2),
  ('gb', 'country_iso', 'GB', 'united kingdom', 'europe', 2),
  ('gdansk', 'city', 'PL', 'poland', 'europe', 3),
  ('gdańsk', 'city', 'PL', 'poland', 'europe', 3),
  ('ge', 'country_iso', 'GE', 'georgia', 'asia', 2),
  ('geelong', 'city', 'AU', 'australia', 'oceania', 3),
  ('gelsenkirchen', 'city', 'DE', 'germany', 'europe', 3),
  ('geneva', 'city', 'CH', 'switzerland', 'europe', 3),
  ('geneve', 'city', 'CH', 'switzerland', 'europe', 3),
  ('genoa', 'city', 'IT', 'italy', 'europe', 3),
  ('genova', 'city', 'IT', 'italy', 'europe', 3),
  ('gent', 'city', 'BE', 'belgium', 'europe', 3),
  ('genève', 'city', 'CH', 'switzerland', 'europe', 3),
  ('georgia', 'country', 'GE', 'georgia', 'asia', 1),
  ('georgia,us', 'state', 'US', 'united states', 'north_america', 4),
  ('germany', 'country', 'DE', 'germany', 'europe', 1),
  ('gh', 'country_iso', 'GH', 'ghana', 'africa', 2),
  ('ghana', 'country', 'GH', 'ghana', 'africa', 1),
  ('ghent', 'city', 'BE', 'belgium', 'europe', 3),
  ('gijon', 'city', 'ES', 'spain', 'europe', 3),
  ('gilbert', 'city', 'US', 'united states', 'north_america', 3),
  ('giza', 'city', 'EG', 'egypt', 'africa', 3),
  ('glasgow', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('glendale', 'city', 'US', 'united states', 'north_america', 3),
  ('gloucestershire', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('gm', 'country_iso', 'GM', 'gambia', 'africa', 2),
  ('gn', 'country_iso', 'GN', 'guinea', 'africa', 2),
  ('goiania', 'city', 'BR', 'brazil', 'south_america', 3),
  ('goiânia', 'city', 'BR', 'brazil', 'south_america', 3),
  ('gold coast', 'city', 'AU', 'australia', 'oceania', 3),
  ('gothenburg', 'city', 'SE', 'sweden', 'europe', 3),
  ('gq', 'country_iso', 'GQ', 'equatorial guinea', 'africa', 2),
  ('gr', 'country_iso', 'GR', 'greece', 'europe', 2),
  ('granada', 'city', 'ES', 'spain', 'europe', 3),
  ('graz', 'city', 'AT', 'austria', 'europe', 3),
  ('great britain', 'alias', 'GB', 'united kingdom', 'europe', 2),
  ('greater manchester', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('greater new york', 'city', 'US', 'united states', 'north_america', 3),
  ('greater noida', 'city', 'IN', 'india', 'asia', 3),
  ('greater seattle', 'city', 'US', 'united states', 'north_america', 3),
  ('greece', 'country', 'GR', 'greece', 'europe', 1),
  ('greensboro', 'city', 'US', 'united states', 'north_america', 3),
  ('grenoble', 'city', 'FR', 'france', 'europe', 3),
  ('groningen', 'city', 'NL', 'netherlands', 'europe', 3),
  ('gt', 'country_iso', 'GT', 'guatemala', 'north_america', 2),
  ('gu,us', 'state', 'US', 'united states', 'north_america', 5),
  ('guadalajara', 'city', 'MX', 'mexico', 'north_america', 3),
  ('guam,us', 'state', 'US', 'united states', 'north_america', 4),
  ('guangzhou', 'city', 'CN', 'china', 'asia', 3),
  ('guatemala', 'country', 'GT', 'guatemala', 'north_america', 1),
  ('guatemala city', 'city', 'GT', 'guatemala', 'north_america', 3),
  ('guelph', 'city', 'CA', 'canada', 'north_america', 3),
  ('guildford', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('guinea', 'country', 'GN', 'guinea', 'africa', 1),
  ('guinea-bissau', 'country', 'GW', 'guinea-bissau', 'africa', 1),
  ('gujarat', 'city', 'IN', 'india', 'asia', 3),
  ('gurgaon', 'city', 'IN', 'india', 'asia', 3),
  ('gurugram', 'city', 'IN', 'india', 'asia', 3),
  ('guyana', 'country', 'GY', 'guyana', 'south_america', 1),
  ('gw', 'country_iso', 'GW', 'guinea-bissau', 'africa', 2),
  ('gwangju', 'city', 'KR', 'south korea', 'asia', 3),
  ('gwynedd', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('gy', 'country_iso', 'GY', 'guyana', 'south_america', 2),
  ('göteborg', 'city', 'SE', 'sweden', 'europe', 3),
  ('haarlem', 'city', 'NL', 'netherlands', 'europe', 3),
  ('hagen', 'city', 'DE', 'germany', 'europe', 3),
  ('haifa', 'city', 'IL', 'israel', 'asia', 3),
  ('haiti', 'country', 'HT', 'haiti', 'north_america', 1),
  ('halifax', 'city', 'CA', 'canada', 'north_america', 3),
  ('halle', 'city', 'DE', 'germany', 'europe', 3),
  ('hamburg', 'city', 'DE', 'germany', 'europe', 3),
  ('hamelin', 'city', 'DE', 'germany', 'europe', 3),
  ('hamilton', 'city', 'CA', 'canada', 'north_america', 3),
  ('hamilton nz', 'city', 'NZ', 'new zealand', 'oceania', 3),
  ('hampshire', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('hampton', 'city', 'US', 'united states', 'north_america', 3),
  ('hangzhou', 'city', 'CN', 'china', 'asia', 3),
  ('hannover', 'city', 'DE', 'germany', 'europe', 3),
  ('hanoi', 'city', 'VN', 'vietnam', 'asia', 3),
  ('hanover', 'city', 'DE', 'germany', 'europe', 3),
  ('hartford', 'city', 'US', 'united states', 'north_america', 3),
  ('haryana', 'city', 'IN', 'india', 'asia', 3),
  ('hasselt', 'city', 'BE', 'belgium', 'europe', 3),
  ('hawaii,us', 'state', 'US', 'united states', 'north_america', 4),
  ('hefei', 'city', 'CN', 'china', 'asia', 3),
  ('heidelberg', 'city', 'DE', 'germany', 'europe', 3),
  ('helsinki', 'city', 'FI', 'finland', 'europe', 3),
  ('henderson', 'city', 'US', 'united states', 'north_america', 3),
  ('heraklion', 'city', 'GR', 'greece', 'europe', 3),
  ('herefordshire', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('herndon', 'city', 'US', 'united states', 'north_america', 3),
  ('hertfordshire', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('herzliya', 'city', 'IL', 'israel', 'asia', 3),
  ('hi,us', 'state', 'US', 'united states', 'north_america', 5),
  ('hialeah', 'city', 'US', 'united states', 'north_america', 3),
  ('highlands', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('hilversum', 'city', 'NL', 'netherlands', 'europe', 3),
  ('hk', 'country_iso', 'HK', 'hong kong', 'asia', 2),
  ('hn', 'country_iso', 'HN', 'honduras', 'north_america', 2),
  ('ho chi minh', 'city', 'VN', 'vietnam', 'asia', 3),
  ('ho chi minh city', 'city', 'VN', 'vietnam', 'asia', 3),
  ('hobart', 'city', 'AU', 'australia', 'oceania', 3),
  ('holland', 'alias', 'NL', 'netherlands', 'europe', 2),
  ('honduras', 'country', 'HN', 'honduras', 'north_america', 1),
  ('hong kong', 'city', 'HK', 'hong kong', 'asia', 3),
  ('hong kong', 'country', 'HK', 'hong kong', 'asia', 1),
  ('hong kong island', 'city', 'HK', 'hong kong', 'asia', 3),
  ('hong kong sar', 'alias', 'HK', 'hong kong', 'asia', 2),
  ('hongkong', 'alias', 'HK', 'hong kong', 'asia', 2),
  ('honolulu', 'city', 'US', 'united states', 'north_america', 3),
  ('hoofddorp', 'city', 'NL', 'netherlands', 'europe', 3),
  ('houston', 'city', 'US', 'united states', 'north_america', 3),
  ('hr', 'country_iso', 'HR', 'croatia', 'europe', 2),
  ('hsinchu', 'city', 'TW', 'taiwan', 'asia', 3),
  ('ht', 'country_iso', 'HT', 'haiti', 'north_america', 2),
  ('hu', 'country_iso', 'HU', 'hungary', 'europe', 2),
  ('hungary', 'country', 'HU', 'hungary', 'europe', 1),
  ('huntsville', 'city', 'US', 'united states', 'north_america', 3),
  ('hyderabad', 'city', 'IN', 'india', 'asia', 3),
  ('ia,us', 'state', 'US', 'united states', 'north_america', 5),
  ('iasi', 'city', 'RO', 'romania', 'europe', 3),
  ('iași', 'city', 'RO', 'romania', 'europe', 3),
  ('iceland', 'country', 'IS', 'iceland', 'europe', 1),
  ('id', 'country_iso', 'ID', 'indonesia', 'asia', 2),
  ('id,us', 'state', 'US', 'united states', 'north_america', 5),
  ('idaho,us', 'state', 'US', 'united states', 'north_america', 4),
  ('ie', 'country_iso', 'IE', 'ireland', 'europe', 2),
  ('il', 'country_iso', 'IL', 'israel', 'asia', 2),
  ('il,us', 'state', 'US', 'united states', 'north_america', 5),
  ('illinois,us', 'state', 'US', 'united states', 'north_america', 4),
  ('in', 'country_iso', 'IN', 'india', 'asia', 2),
  ('in,us', 'state', 'US', 'united states', 'north_america', 5),
  ('incheon', 'city', 'KR', 'south korea', 'asia', 3),
  ('india', 'country', 'IN', 'india', 'asia', 1),
  ('indiana,us', 'state', 'US', 'united states', 'north_america', 4),
  ('indianapolis', 'city', 'US', 'united states', 'north_america', 3),
  ('indonesia', 'country', 'ID', 'indonesia', 'asia', 1),
  ('indore', 'city', 'IN', 'india', 'asia', 3),
  ('ingolstadt', 'city', 'DE', 'germany', 'europe', 3),
  ('innsbruck', 'city', 'AT', 'austria', 'europe', 3),
  ('ioannina', 'city', 'GR', 'greece', 'europe', 3),
  ('iowa,us', 'state', 'US', 'united states', 'north_america', 4),
  ('ipswich', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('iq', 'country_iso', 'IQ', 'iraq', 'asia', 2),
  ('ir', 'country_iso', 'IR', 'iran', 'asia', 2),
  ('iran', 'country', 'IR', 'iran', 'asia', 1),
  ('iraq', 'country', 'IQ', 'iraq', 'asia', 1),
  ('ireland', 'country', 'IE', 'ireland', 'europe', 1),
  ('irvine', 'city', 'US', 'united states', 'north_america', 3),
  ('is', 'country_iso', 'IS', 'iceland', 'europe', 2),
  ('islamabad', 'city', 'PK', 'pakistan', 'asia', 3),
  ('israel', 'country', 'IL', 'israel', 'asia', 1),
  ('issy-les-moulineaux', 'city', 'FR', 'france', 'europe', 3),
  ('istanbul', 'city', 'TR', 'turkey', 'asia', 3),
  ('it', 'country_iso', 'IT', 'italy', 'europe', 2),
  ('italia', 'alias', 'IT', 'italy', 'europe', 2),
  ('italy', 'country', 'IT', 'italy', 'europe', 1),
  ('ithaca', 'city', 'US', 'united states', 'north_america', 3),
  ('ivano-frankivsk', 'city', 'UA', 'ukraine', 'europe', 3),
  ('ivory coast', 'country', 'CI', 'ivory coast', 'africa', 1),
  ('izmir', 'city', 'TR', 'turkey', 'asia', 3),
  ('jackson', 'city', 'US', 'united states', 'north_america', 3),
  ('jacksonville', 'city', 'US', 'united states', 'north_america', 3),
  ('jaipur', 'city', 'IN', 'india', 'asia', 3),
  ('jakarta', 'city', 'ID', 'indonesia', 'asia', 3),
  ('jamaica', 'country', 'JM', 'jamaica', 'north_america', 1),
  ('japan', 'country', 'JP', 'japan', 'asia', 1),
  ('jeddah', 'city', 'SA', 'saudi arabia', 'asia', 3),
  ('jena', 'city', 'DE', 'germany', 'europe', 3),
  ('jersey city', 'city', 'US', 'united states', 'north_america', 3),
  ('jerusalem', 'city', 'IL', 'israel', 'asia', 3),
  ('jm', 'country_iso', 'JM', 'jamaica', 'north_america', 2),
  ('jo', 'country_iso', 'JO', 'jordan', 'asia', 2),
  ('johannesburg', 'city', 'ZA', 'south africa', 'africa', 3),
  ('johor bahru', 'city', 'MY', 'malaysia', 'asia', 3),
  ('joinville', 'city', 'BR', 'brazil', 'south_america', 3),
  ('jordan', 'country', 'JO', 'jordan', 'asia', 1),
  ('jp', 'country_iso', 'JP', 'japan', 'asia', 2),
  ('kansas city', 'city', 'US', 'united states', 'north_america', 3),
  ('kansas,us', 'state', 'US', 'united states', 'north_america', 4),
  ('kaohsiung', 'city', 'TW', 'taiwan', 'asia', 3),
  ('karachi', 'city', 'PK', 'pakistan', 'asia', 3),
  ('karlsruhe', 'city', 'DE', 'germany', 'europe', 3),
  ('karnataka', 'city', 'IN', 'india', 'asia', 3),
  ('kassel', 'city', 'DE', 'germany', 'europe', 3),
  ('kathmandu', 'city', 'NP', 'nepal', 'asia', 3),
  ('katowice', 'city', 'PL', 'poland', 'europe', 3),
  ('kavala', 'city', 'GR', 'greece', 'europe', 3),
  ('kazakhstan', 'country', 'KZ', 'kazakhstan', 'asia', 1),
  ('ke', 'country_iso', 'KE', 'kenya', 'africa', 2),
  ('kelowna', 'city', 'CA', 'canada', 'north_america', 3),
  ('kempten', 'city', 'DE', 'germany', 'europe', 3),
  ('kent', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('kentucky,us', 'state', 'US', 'united states', 'north_america', 4),
  ('kenya', 'country', 'KE', 'kenya', 'africa', 1),
  ('kerala', 'city', 'IN', 'india', 'asia', 3),
  ('kg', 'country_iso', 'KG', 'kyrgyzstan', 'asia', 2),
  ('kh', 'country_iso', 'KH', 'cambodia', 'asia', 2),
  ('kharkiv', 'city', 'UA', 'ukraine', 'europe', 3),
  ('kiel', 'city', 'DE', 'germany', 'europe', 3),
  ('kiev', 'city', 'UA', 'ukraine', 'europe', 3),
  ('kindsbach', 'city', 'DE', 'germany', 'europe', 3),
  ('kingston', 'city', 'CA', 'canada', 'north_america', 3),
  ('kirkland', 'city', 'US', 'united states', 'north_america', 3),
  ('kitchener', 'city', 'CA', 'canada', 'north_america', 3),
  ('klagenfurt', 'city', 'AT', 'austria', 'europe', 3),
  ('kobe', 'city', 'JP', 'japan', 'asia', 3),
  ('kobenhavn', 'city', 'DK', 'denmark', 'europe', 3),
  ('koblenz', 'city', 'DE', 'germany', 'europe', 3),
  ('kochi', 'city', 'IN', 'india', 'asia', 3),
  ('kolkata', 'city', 'IN', 'india', 'asia', 3),
  ('koln', 'city', 'DE', 'germany', 'europe', 3),
  ('korea', 'alias', 'KR', 'south korea', 'asia', 2),
  ('kosice', 'city', 'SK', 'slovakia', 'europe', 3),
  ('kosovo', 'country', 'XK', 'kosovo', 'europe', 1),
  ('kota kinabalu', 'city', 'MY', 'malaysia', 'asia', 3),
  ('kowloon', 'city', 'HK', 'hong kong', 'asia', 3),
  ('košice', 'city', 'SK', 'slovakia', 'europe', 3),
  ('kp', 'country_iso', 'KP', 'north korea', 'asia', 2),
  ('kr', 'country_iso', 'KR', 'south korea', 'asia', 2),
  ('krakow', 'city', 'PL', 'poland', 'europe', 3),
  ('kraków', 'city', 'PL', 'poland', 'europe', 3),
  ('krefeld', 'city', 'DE', 'germany', 'europe', 3),
  ('ks,us', 'state', 'US', 'united states', 'north_america', 5),
  ('ksa', 'alias', 'SA', 'saudi arabia', 'asia', 2),
  ('kuala lumpur', 'city', 'MY', 'malaysia', 'asia', 3),
  ('kuching', 'city', 'MY', 'malaysia', 'asia', 3),
  ('kuwait', 'country', 'KW', 'kuwait', 'asia', 1),
  ('kuwait city', 'city', 'KW', 'kuwait', 'asia', 3),
  ('kw', 'country_iso', 'KW', 'kuwait', 'asia', 2),
  ('ky,us', 'state', 'US', 'united states', 'north_america', 5),
  ('kyiv', 'city', 'UA', 'ukraine', 'europe', 3),
  ('kyoto', 'city', 'JP', 'japan', 'asia', 3),
  ('kyrgyzstan', 'country', 'KG', 'kyrgyzstan', 'asia', 1),
  ('kz', 'country_iso', 'KZ', 'kazakhstan', 'asia', 2),
  ('köln', 'city', 'DE', 'germany', 'europe', 3),
  ('københavn', 'city', 'DK', 'denmark', 'europe', 3),
  ('la', 'country_iso', 'LA', 'laos', 'asia', 2),
  ('la defense', 'city', 'FR', 'france', 'europe', 3),
  ('la plata', 'city', 'AR', 'argentina', 'south_america', 3),
  ('la,us', 'state', 'US', 'united states', 'north_america', 5),
  ('lagos', 'city', 'NG', 'nigeria', 'africa', 3),
  ('lahore', 'city', 'PK', 'pakistan', 'asia', 3),
  ('lancashire', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('langley', 'city', 'CA', 'canada', 'north_america', 3),
  ('lansing', 'city', 'US', 'united states', 'north_america', 3),
  ('laos', 'country', 'LA', 'laos', 'asia', 1),
  ('larissa', 'city', 'GR', 'greece', 'europe', 3),
  ('larnaca', 'city', 'CY', 'cyprus', 'europe', 3),
  ('las palmas', 'city', 'ES', 'spain', 'europe', 3),
  ('las vegas', 'city', 'US', 'united states', 'north_america', 3),
  ('latvia', 'country', 'LV', 'latvia', 'europe', 1),
  ('lausanne', 'city', 'CH', 'switzerland', 'europe', 3),
  ('laval', 'city', 'CA', 'canada', 'north_america', 3),
  ('lb', 'country_iso', 'LB', 'lebanon', 'asia', 2),
  ('le mans', 'city', 'FR', 'france', 'europe', 3),
  ('leamington spa', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('lebanon', 'country', 'LB', 'lebanon', 'asia', 1),
  ('lecce', 'city', 'IT', 'italy', 'europe', 3),
  ('leeds', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('leicester', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('leicestershire', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('leiden', 'city', 'NL', 'netherlands', 'europe', 3),
  ('leipzig', 'city', 'DE', 'germany', 'europe', 3),
  ('leon', 'city', 'MX', 'mexico', 'north_america', 3),
  ('lesotho', 'country', 'LS', 'lesotho', 'africa', 1),
  ('lethbridge', 'city', 'CA', 'canada', 'north_america', 3),
  ('leuven', 'city', 'BE', 'belgium', 'europe', 3),
  ('levallois-perret', 'city', 'FR', 'france', 'europe', 3),
  ('leverkusen', 'city', 'DE', 'germany', 'europe', 3),
  ('león', 'city', 'MX', 'mexico', 'north_america', 3),
  ('li', 'country_iso', 'LI', 'liechtenstein', 'europe', 2),
  ('liberia', 'country', 'LR', 'liberia', 'africa', 1),
  ('libya', 'country', 'LY', 'libya', 'africa', 1),
  ('liechtenstein', 'country', 'LI', 'liechtenstein', 'europe', 1),
  ('liege', 'city', 'BE', 'belgium', 'europe', 3),
  ('lille', 'city', 'FR', 'france', 'europe', 3),
  ('lima', 'city', 'PE', 'peru', 'south_america', 3),
  ('limassol', 'city', 'CY', 'cyprus', 'europe', 3),
  ('limerick', 'city', 'IE', 'ireland', 'europe', 3),
  ('lincoln', 'city', 'US', 'united states', 'north_america', 3),
  ('linkoping', 'city', 'SE', 'sweden', 'europe', 3),
  ('linköping', 'city', 'SE', 'sweden', 'europe', 3),
  ('linz', 'city', 'AT', 'austria', 'europe', 3),
  ('lisboa', 'city', 'PT', 'portugal', 'europe', 3),
  ('lisbon', 'city', 'PT', 'portugal', 'europe', 3),
  ('lithuania', 'country', 'LT', 'lithuania', 'europe', 1),
  ('little rock', 'city', 'US', 'united states', 'north_america', 3),
  ('liverpool', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('liège', 'city', 'BE', 'belgium', 'europe', 3),
  ('ljubljana', 'city', 'SI', 'slovenia', 'europe', 3),
  ('lk', 'country_iso', 'LK', 'sri lanka', 'asia', 2),
  ('lodz', 'city', 'PL', 'poland', 'europe', 3),
  ('london', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('london ontario', 'city', 'CA', 'canada', 'north_america', 3),
  ('long beach', 'city', 'US', 'united states', 'north_america', 3),
  ('longueuil', 'city', 'CA', 'canada', 'north_america', 3),
  ('los angeles', 'city', 'US', 'united states', 'north_america', 3),
  ('lothian', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('louisiana,us', 'state', 'US', 'united states', 'north_america', 4),
  ('louisville', 'city', 'US', 'united states', 'north_america', 3),
  ('lr', 'country_iso', 'LR', 'liberia', 'africa', 2),
  ('ls', 'country_iso', 'LS', 'lesotho', 'africa', 2),
  ('lt', 'country_iso', 'LT', 'lithuania', 'europe', 2),
  ('lu', 'country_iso', 'LU', 'luxembourg', 'europe', 2),
  ('lubbock', 'city', 'US', 'united states', 'north_america', 3),
  ('lubeck', 'city', 'DE', 'germany', 'europe', 3),
  ('lucerne', 'city', 'CH', 'switzerland', 'europe', 3),
  ('lucknow', 'city', 'IN', 'india', 'asia', 3),
  ('ludwigsburg', 'city', 'DE', 'germany', 'europe', 3),
  ('lugano', 'city', 'CH', 'switzerland', 'europe', 3),
  ('lund', 'city', 'SE', 'sweden', 'europe', 3),
  ('luneburg', 'city', 'DE', 'germany', 'europe', 3),
  ('luton', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('luxembourg', 'city', 'LU', 'luxembourg', 'europe', 3),
  ('luxembourg', 'country', 'LU', 'luxembourg', 'europe', 1),
  ('luxembourg city', 'city', 'LU', 'luxembourg', 'europe', 3),
  ('luzern', 'city', 'CH', 'switzerland', 'europe', 3),
  ('lv', 'country_iso', 'LV', 'latvia', 'europe', 2),
  ('lviv', 'city', 'UA', 'ukraine', 'europe', 3),
  ('ly', 'country_iso', 'LY', 'libya', 'africa', 2),
  ('lynn', 'city', 'US', 'united states', 'north_america', 3),
  ('lyon', 'city', 'FR', 'france', 'europe', 3),
  ('lübeck', 'city', 'DE', 'germany', 'europe', 3),
  ('lüneburg', 'city', 'DE', 'germany', 'europe', 3),
  ('ma', 'country_iso', 'MA', 'morocco', 'africa', 2),
  ('ma,us', 'state', 'US', 'united states', 'north_america', 5),
  ('maastricht', 'city', 'NL', 'netherlands', 'europe', 3),
  ('macao', 'alias', 'MO', 'macau', 'asia', 2),
  ('macau', 'country', 'MO', 'macau', 'asia', 1),
  ('macedonia', 'alias', 'MK', 'north macedonia', 'europe', 2),
  ('madagascar', 'country', 'MG', 'madagascar', 'africa', 1),
  ('madison', 'city', 'US', 'united states', 'north_america', 3),
  ('madrid', 'city', 'ES', 'spain', 'europe', 3),
  ('magdeburg', 'city', 'DE', 'germany', 'europe', 3),
  ('maharashtra', 'city', 'IN', 'india', 'asia', 3),
  ('maine,us', 'state', 'US', 'united states', 'north_america', 4),
  ('mainland china', 'alias', 'CN', 'china', 'asia', 2),
  ('mainz', 'city', 'DE', 'germany', 'europe', 3),
  ('makati', 'city', 'PH', 'philippines', 'asia', 3),
  ('malaga', 'city', 'ES', 'spain', 'europe', 3),
  ('malawi', 'country', 'MW', 'malawi', 'africa', 1),
  ('malaysia', 'country', 'MY', 'malaysia', 'asia', 1),
  ('maldives', 'country', 'MV', 'maldives', 'asia', 1),
  ('mali', 'country', 'ML', 'mali', 'africa', 1),
  ('malmo', 'city', 'SE', 'sweden', 'europe', 3),
  ('malmö', 'city', 'SE', 'sweden', 'europe', 3),
  ('malta', 'country', 'MT', 'malta', 'europe', 1),
  ('manama', 'city', 'BH', 'bahrain', 'asia', 3),
  ('manchester', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('mandaluyong', 'city', 'PH', 'philippines', 'asia', 3),
  ('manhattan', 'city', 'US', 'united states', 'north_america', 3),
  ('manila', 'city', 'PH', 'philippines', 'asia', 3),
  ('manitoba,ca', 'state', 'CA', 'canada', 'north_america', 4),
  ('mannheim', 'city', 'DE', 'germany', 'europe', 3),
  ('maribor', 'city', 'SI', 'slovenia', 'europe', 3),
  ('markham', 'city', 'CA', 'canada', 'north_america', 3),
  ('marktoberdorf', 'city', 'DE', 'germany', 'europe', 3),
  ('marl', 'city', 'DE', 'germany', 'europe', 3),
  ('marne-la-vallee', 'city', 'FR', 'france', 'europe', 3),
  ('marrakech', 'city', 'MA', 'morocco', 'africa', 3),
  ('marseille', 'city', 'FR', 'france', 'europe', 3),
  ('maryland,us', 'state', 'US', 'united states', 'north_america', 4),
  ('massachusetts,us', 'state', 'US', 'united states', 'north_america', 4),
  ('mauritania', 'country', 'MR', 'mauritania', 'africa', 1),
  ('mauritius', 'country', 'MU', 'mauritius', 'africa', 1),
  ('mb,ca', 'state', 'CA', 'canada', 'north_america', 5),
  ('mc', 'country_iso', 'MC', 'monaco', 'europe', 2),
  ('mcallen', 'city', 'US', 'united states', 'north_america', 3),
  ('mclean', 'city', 'US', 'united states', 'north_america', 3),
  ('md', 'country_iso', 'MD', 'moldova', 'europe', 2),
  ('md,us', 'state', 'US', 'united states', 'north_america', 5),
  ('me', 'country_iso', 'ME', 'montenegro', 'europe', 2),
  ('me,us', 'state', 'US', 'united states', 'north_america', 5),
  ('mechelen', 'city', 'BE', 'belgium', 'europe', 3),
  ('medan', 'city', 'ID', 'indonesia', 'asia', 3),
  ('medellin', 'city', 'CO', 'colombia', 'south_america', 3),
  ('medellín', 'city', 'CO', 'colombia', 'south_america', 3),
  ('medicine hat', 'city', 'CA', 'canada', 'north_america', 3),
  ('melbourne', 'city', 'AU', 'australia', 'oceania', 3),
  ('memphis', 'city', 'US', 'united states', 'north_america', 3),
  ('mendoza', 'city', 'AR', 'argentina', 'south_america', 3),
  ('menlo park', 'city', 'US', 'united states', 'north_america', 3),
  ('merseyside', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('mesa', 'city', 'US', 'united states', 'north_america', 3),
  ('metz', 'city', 'FR', 'france', 'europe', 3),
  ('mexico', 'country', 'MX', 'mexico', 'north_america', 1),
  ('mexico city', 'city', 'MX', 'mexico', 'north_america', 3),
  ('mg', 'country_iso', 'MG', 'madagascar', 'africa', 2),
  ('mi,us', 'state', 'US', 'united states', 'north_america', 5),
  ('miami', 'city', 'US', 'united states', 'north_america', 3),
  ('michigan,us', 'state', 'US', 'united states', 'north_america', 4),
  ('mid glamorgan', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('midrand', 'city', 'ZA', 'south africa', 'africa', 3),
  ('milan', 'city', 'IT', 'italy', 'europe', 3),
  ('milano', 'city', 'IT', 'italy', 'europe', 3),
  ('milton keynes', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('milwaukee', 'city', 'US', 'united states', 'north_america', 3),
  ('minneapolis', 'city', 'US', 'united states', 'north_america', 3),
  ('minnesota,us', 'state', 'US', 'united states', 'north_america', 4),
  ('mississauga', 'city', 'CA', 'canada', 'north_america', 3),
  ('mississippi,us', 'state', 'US', 'united states', 'north_america', 4),
  ('missouri,us', 'state', 'US', 'united states', 'north_america', 4),
  ('mk', 'country_iso', 'MK', 'north macedonia', 'europe', 2),
  ('ml', 'country_iso', 'ML', 'mali', 'africa', 2),
  ('mm', 'country_iso', 'MM', 'myanmar', 'asia', 2),
  ('mn', 'country_iso', 'MN', 'mongolia', 'asia', 2),
  ('mn,us', 'state', 'US', 'united states', 'north_america', 5),
  ('mo', 'country_iso', 'MO', 'macau', 'asia', 2),
  ('mo,us', 'state', 'US', 'united states', 'north_america', 5),
  ('modena', 'city', 'IT', 'italy', 'europe', 3),
  ('modesto', 'city', 'US', 'united states', 'north_america', 3),
  ('moldova', 'country', 'MD', 'moldova', 'europe', 1),
  ('monaco', 'country', 'MC', 'monaco', 'europe', 1),
  ('monchengladbach', 'city', 'DE', 'germany', 'europe', 3),
  ('moncton', 'city', 'CA', 'canada', 'north_america', 3),
  ('mongolia', 'country', 'MN', 'mongolia', 'asia', 1),
  ('montana,us', 'state', 'US', 'united states', 'north_america', 4),
  ('montenegro', 'country', 'ME', 'montenegro', 'europe', 1),
  ('monterrey', 'city', 'MX', 'mexico', 'north_america', 3),
  ('montevideo', 'city', 'UY', 'uruguay', 'south_america', 3),
  ('montgomery', 'city', 'US', 'united states', 'north_america', 3),
  ('montpellier', 'city', 'FR', 'france', 'europe', 3),
  ('montreal', 'city', 'CA', 'canada', 'north_america', 3),
  ('monza', 'city', 'IT', 'italy', 'europe', 3),
  ('morocco', 'country', 'MA', 'morocco', 'africa', 1),
  ('moscow', 'city', 'RU', 'russia', 'europe', 3),
  ('moskva', 'city', 'RU', 'russia', 'europe', 3),
  ('mountain view', 'city', 'US', 'united states', 'north_america', 3),
  ('mozambique', 'country', 'MZ', 'mozambique', 'africa', 1),
  ('mp,us', 'state', 'US', 'united states', 'north_america', 5),
  ('mr', 'country_iso', 'MR', 'mauritania', 'africa', 2),
  ('ms,us', 'state', 'US', 'united states', 'north_america', 5),
  ('mt', 'country_iso', 'MT', 'malta', 'europe', 2),
  ('mt,us', 'state', 'US', 'united states', 'north_america', 5),
  ('mu', 'country_iso', 'MU', 'mauritius', 'africa', 2),
  ('mumbai', 'city', 'IN', 'india', 'asia', 3),
  ('munchen', 'city', 'DE', 'germany', 'europe', 3),
  ('munich', 'city', 'DE', 'germany', 'europe', 3),
  ('munster', 'city', 'DE', 'germany', 'europe', 3),
  ('murcia', 'city', 'ES', 'spain', 'europe', 3),
  ('muscat', 'city', 'OM', 'oman', 'asia', 3),
  ('mv', 'country_iso', 'MV', 'maldives', 'asia', 2),
  ('mw', 'country_iso', 'MW', 'malawi', 'africa', 2),
  ('mx', 'country_iso', 'MX', 'mexico', 'north_america', 2),
  ('my', 'country_iso', 'MY', 'malaysia', 'asia', 2),
  ('myanmar', 'country', 'MM', 'myanmar', 'asia', 1),
  ('mysore', 'city', 'IN', 'india', 'asia', 3),
  ('mysuru', 'city', 'IN', 'india', 'asia', 3),
  ('mz', 'country_iso', 'MZ', 'mozambique', 'africa', 2),
  ('málaga', 'city', 'ES', 'spain', 'europe', 3),
  ('méxico', 'alias', 'MX', 'mexico', 'north_america', 2),
  ('mönchengladbach', 'city', 'DE', 'germany', 'europe', 3),
  ('münchen', 'city', 'DE', 'germany', 'europe', 3),
  ('münster', 'city', 'DE', 'germany', 'europe', 3),
  ('na', 'country_iso', 'NA', 'namibia', 'africa', 2),
  ('nagoya', 'city', 'JP', 'japan', 'asia', 3),
  ('nagpur', 'city', 'IN', 'india', 'asia', 3),
  ('naha', 'city', 'JP', 'japan', 'asia', 3),
  ('nairobi', 'city', 'KE', 'kenya', 'africa', 3),
  ('namibia', 'country', 'NA', 'namibia', 'africa', 1),
  ('namur', 'city', 'BE', 'belgium', 'europe', 3),
  ('nanaimo', 'city', 'CA', 'canada', 'north_america', 3),
  ('nancy', 'city', 'FR', 'france', 'europe', 3),
  ('nanjing', 'city', 'CN', 'china', 'asia', 3),
  ('nanterre', 'city', 'FR', 'france', 'europe', 3),
  ('nantes', 'city', 'FR', 'france', 'europe', 3),
  ('naperville', 'city', 'US', 'united states', 'north_america', 3),
  ('naples', 'city', 'IT', 'italy', 'europe', 3),
  ('naples fl', 'city', 'US', 'united states', 'north_america', 3),
  ('napoli', 'city', 'IT', 'italy', 'europe', 3),
  ('nashville', 'city', 'US', 'united states', 'north_america', 3),
  ('navi mumbai', 'city', 'IN', 'india', 'asia', 3),
  ('nb,ca', 'state', 'CA', 'canada', 'north_america', 5),
  ('nc', 'country_iso', 'NC', 'new caledonia', 'oceania', 2),
  ('nc,us', 'state', 'US', 'united states', 'north_america', 5),
  ('nd,us', 'state', 'US', 'united states', 'north_america', 5),
  ('ne', 'country_iso', 'NE', 'niger', 'africa', 2),
  ('ne,us', 'state', 'US', 'united states', 'north_america', 5),
  ('nebraska,us', 'state', 'US', 'united states', 'north_america', 4),
  ('nepal', 'country', 'NP', 'nepal', 'asia', 1),
  ('netanya', 'city', 'IL', 'israel', 'asia', 3),
  ('netherlands', 'country', 'NL', 'netherlands', 'europe', 1),
  ('neu-ulm', 'city', 'DE', 'germany', 'europe', 3),
  ('neuchatel', 'city', 'CH', 'switzerland', 'europe', 3),
  ('neuchâtel', 'city', 'CH', 'switzerland', 'europe', 3),
  ('nevada,us', 'state', 'US', 'united states', 'north_america', 4),
  ('new brunswick,ca', 'state', 'CA', 'canada', 'north_america', 4),
  ('new caledonia', 'country', 'NC', 'new caledonia', 'oceania', 1),
  ('new delhi', 'city', 'IN', 'india', 'asia', 3),
  ('new hampshire,us', 'state', 'US', 'united states', 'north_america', 4),
  ('new haven', 'city', 'US', 'united states', 'north_america', 3),
  ('new jersey,us', 'state', 'US', 'united states', 'north_america', 4),
  ('new mexico,us', 'state', 'US', 'united states', 'north_america', 4),
  ('new orleans', 'city', 'US', 'united states', 'north_america', 3),
  ('new south wales,au', 'state', 'AU', 'australia', 'oceania', 4),
  ('new territories', 'city', 'HK', 'hong kong', 'asia', 3),
  ('new york', 'city', 'US', 'united states', 'north_america', 3),
  ('new york city', 'city', 'US', 'united states', 'north_america', 3),
  ('new york metro', 'city', 'US', 'united states', 'north_america', 3),
  ('new york,us', 'state', 'US', 'united states', 'north_america', 4),
  ('new zealand', 'country', 'NZ', 'new zealand', 'oceania', 1),
  ('newark', 'city', 'US', 'united states', 'north_america', 3),
  ('newcastle', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('newcastle nsw', 'city', 'AU', 'australia', 'oceania', 3),
  ('newcastle upon tyne', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('newfoundland and labrador,ca', 'state', 'CA', 'canada', 'north_america', 4),
  ('newport', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('ng', 'country_iso', 'NG', 'nigeria', 'africa', 2),
  ('nh,us', 'state', 'US', 'united states', 'north_america', 5),
  ('ni', 'country_iso', 'NI', 'nicaragua', 'north_america', 2),
  ('nicaragua', 'country', 'NI', 'nicaragua', 'north_america', 1),
  ('nice', 'city', 'FR', 'france', 'europe', 3),
  ('nicosia', 'city', 'CY', 'cyprus', 'europe', 3),
  ('nieuwegein', 'city', 'NL', 'netherlands', 'europe', 3),
  ('niger', 'country', 'NE', 'niger', 'africa', 1),
  ('nigeria', 'country', 'NG', 'nigeria', 'africa', 1),
  ('nijmegen', 'city', 'NL', 'netherlands', 'europe', 3),
  ('ningbo', 'city', 'CN', 'china', 'asia', 3),
  ('nis', 'city', 'RS', 'serbia', 'europe', 3),
  ('niteroi', 'city', 'BR', 'brazil', 'south_america', 3),
  ('niterói', 'city', 'BR', 'brazil', 'south_america', 3),
  ('niš', 'city', 'RS', 'serbia', 'europe', 3),
  ('nj,us', 'state', 'US', 'united states', 'north_america', 5),
  ('nl', 'country_iso', 'NL', 'netherlands', 'europe', 2),
  ('nl,ca', 'state', 'CA', 'canada', 'north_america', 5),
  ('nm,us', 'state', 'US', 'united states', 'north_america', 5),
  ('no', 'country_iso', 'NO', 'norway', 'europe', 2),
  ('noida', 'city', 'IN', 'india', 'asia', 3),
  ('noida extension', 'city', 'IN', 'india', 'asia', 3),
  ('noord-holland', 'city', 'NL', 'netherlands', 'europe', 3),
  ('nordlingen', 'city', 'DE', 'germany', 'europe', 3),
  ('norfolk', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('north carolina,us', 'state', 'US', 'united states', 'north_america', 4),
  ('north dakota,us', 'state', 'US', 'united states', 'north_america', 4),
  ('north korea', 'country', 'KP', 'north korea', 'asia', 1),
  ('north macedonia', 'country', 'MK', 'north macedonia', 'europe', 1),
  ('north york', 'city', 'CA', 'canada', 'north_america', 3),
  ('north yorkshire', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('northamptonshire', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('northern ireland', 'alias', 'GB', 'united kingdom', 'europe', 2),
  ('northern mariana islands,us', 'state', 'US', 'united states', 'north_america', 4),
  ('northern territory,au', 'state', 'AU', 'australia', 'oceania', 4),
  ('northumberland', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('northwest territories,ca', 'state', 'CA', 'canada', 'north_america', 4),
  ('norway', 'country', 'NO', 'norway', 'europe', 1),
  ('norwich', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('nottingham', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('nova scotia,ca', 'state', 'CA', 'canada', 'north_america', 4),
  ('novi sad', 'city', 'RS', 'serbia', 'europe', 3),
  ('novosibirsk', 'city', 'RU', 'russia', 'europe', 3),
  ('np', 'country_iso', 'NP', 'nepal', 'asia', 2),
  ('ns,ca', 'state', 'CA', 'canada', 'north_america', 5),
  ('nsw,au', 'state', 'AU', 'australia', 'oceania', 5),
  ('nt,au', 'state', 'AU', 'australia', 'oceania', 5),
  ('nt,ca', 'state', 'CA', 'canada', 'north_america', 5),
  ('nu,ca', 'state', 'CA', 'canada', 'north_america', 5),
  ('nunavut,ca', 'state', 'CA', 'canada', 'north_america', 4),
  ('nur-sultan', 'city', 'KZ', 'kazakhstan', 'asia', 3),
  ('nuremberg', 'city', 'DE', 'germany', 'europe', 3),
  ('nurnberg', 'city', 'DE', 'germany', 'europe', 3),
  ('nv,us', 'state', 'US', 'united states', 'north_america', 5),
  ('ny,us', 'state', 'US', 'united states', 'north_america', 5),
  ('nyc', 'city', 'US', 'united states', 'north_america', 3),
  ('nz', 'country_iso', 'NZ', 'new zealand', 'oceania', 2),
  ('nördlingen', 'city', 'DE', 'germany', 'europe', 3),
  ('nürnberg', 'city', 'DE', 'germany', 'europe', 3),
  ('oak park', 'city', 'US', 'united states', 'north_america', 3),
  ('oakland', 'city', 'US', 'united states', 'north_america', 3),
  ('oakville', 'city', 'CA', 'canada', 'north_america', 3),
  ('odense', 'city', 'DK', 'denmark', 'europe', 3),
  ('odesa', 'city', 'UA', 'ukraine', 'europe', 3),
  ('odessa', 'city', 'UA', 'ukraine', 'europe', 3),
  ('offenbach', 'city', 'DE', 'germany', 'europe', 3),
  ('oh,us', 'state', 'US', 'united states', 'north_america', 5),
  ('ohio,us', 'state', 'US', 'united states', 'north_america', 4),
  ('ok,us', 'state', 'US', 'united states', 'north_america', 5),
  ('oklahoma city', 'city', 'US', 'united states', 'north_america', 3),
  ('oklahoma,us', 'state', 'US', 'united states', 'north_america', 4),
  ('olomouc', 'city', 'CZ', 'czechia', 'europe', 3),
  ('om', 'country_iso', 'OM', 'oman', 'asia', 2),
  ('omaha', 'city', 'US', 'united states', 'north_america', 3),
  ('oman', 'country', 'OM', 'oman', 'asia', 1),
  ('on,ca', 'state', 'CA', 'canada', 'north_america', 5),
  ('ontario,ca', 'state', 'CA', 'canada', 'north_america', 4),
  ('or,us', 'state', 'US', 'united states', 'north_america', 5),
  ('oradea', 'city', 'RO', 'romania', 'europe', 3),
  ('oregon,us', 'state', 'US', 'united states', 'north_america', 4),
  ('orlando', 'city', 'US', 'united states', 'north_america', 3),
  ('orleans', 'city', 'FR', 'france', 'europe', 3),
  ('osaka', 'city', 'JP', 'japan', 'asia', 3),
  ('osasco', 'city', 'BR', 'brazil', 'south_america', 3),
  ('oshawa', 'city', 'CA', 'canada', 'north_america', 3),
  ('oslo', 'city', 'NO', 'norway', 'europe', 3),
  ('osnabruck', 'city', 'DE', 'germany', 'europe', 3),
  ('osnabrück', 'city', 'DE', 'germany', 'europe', 3),
  ('ostrava', 'city', 'CZ', 'czechia', 'europe', 3),
  ('ottawa', 'city', 'CA', 'canada', 'north_america', 3),
  ('oulu', 'city', 'FI', 'finland', 'europe', 3),
  ('oxford', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('oxfordshire', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('pa', 'country_iso', 'PA', 'panama', 'north_america', 2),
  ('pa,us', 'state', 'US', 'united states', 'north_america', 5),
  ('padova', 'city', 'IT', 'italy', 'europe', 3),
  ('padua', 'city', 'IT', 'italy', 'europe', 3),
  ('pakistan', 'country', 'PK', 'pakistan', 'asia', 1),
  ('palermo', 'city', 'IT', 'italy', 'europe', 3),
  ('palestine', 'country', 'PS', 'palestine', 'asia', 1),
  ('palma', 'city', 'ES', 'spain', 'europe', 3),
  ('palo alto', 'city', 'US', 'united states', 'north_america', 3),
  ('pamplona', 'city', 'ES', 'spain', 'europe', 3),
  ('panama', 'city', 'PA', 'panama', 'north_america', 3),
  ('panama', 'country', 'PA', 'panama', 'north_america', 1),
  ('panama city', 'city', 'PA', 'panama', 'north_america', 3),
  ('panamá', 'alias', 'PA', 'panama', 'north_america', 2),
  ('paphos', 'city', 'CY', 'cyprus', 'europe', 3),
  ('papua new guinea', 'country', 'PG', 'papua new guinea', 'oceania', 1),
  ('paraguay', 'country', 'PY', 'paraguay', 'south_america', 1),
  ('paramus', 'city', 'US', 'united states', 'north_america', 3),
  ('paris', 'city', 'FR', 'france', 'europe', 3),
  ('parma', 'city', 'IT', 'italy', 'europe', 3),
  ('pasadena', 'city', 'US', 'united states', 'north_america', 3),
  ('pasay', 'city', 'PH', 'philippines', 'asia', 3),
  ('pasig', 'city', 'PH', 'philippines', 'asia', 3),
  ('patras', 'city', 'GR', 'greece', 'europe', 3),
  ('pe', 'country_iso', 'PE', 'peru', 'south_america', 2),
  ('pe,ca', 'state', 'CA', 'canada', 'north_america', 5),
  ('penang', 'city', 'MY', 'malaysia', 'asia', 3),
  ('pennsylvania,us', 'state', 'US', 'united states', 'north_america', 4),
  ('peoria', 'city', 'US', 'united states', 'north_america', 3),
  ('perpignan', 'city', 'FR', 'france', 'europe', 3),
  ('perth', 'city', 'AU', 'australia', 'oceania', 3),
  ('peru', 'country', 'PE', 'peru', 'south_america', 1),
  ('perugia', 'city', 'IT', 'italy', 'europe', 3),
  ('perú', 'alias', 'PE', 'peru', 'south_america', 2),
  ('pescara', 'city', 'IT', 'italy', 'europe', 3),
  ('petah tikva', 'city', 'IL', 'israel', 'asia', 3),
  ('petaling jaya', 'city', 'MY', 'malaysia', 'asia', 3),
  ('pf', 'country_iso', 'PF', 'french polynesia', 'oceania', 2),
  ('pg', 'country_iso', 'PG', 'papua new guinea', 'oceania', 2),
  ('ph', 'country_iso', 'PH', 'philippines', 'asia', 2),
  ('philadelphia', 'city', 'US', 'united states', 'north_america', 3),
  ('philippines', 'country', 'PH', 'philippines', 'asia', 1),
  ('phnom penh', 'city', 'KH', 'cambodia', 'asia', 3),
  ('phoenix', 'city', 'US', 'united states', 'north_america', 3),
  ('phuket', 'city', 'TH', 'thailand', 'asia', 3),
  ('pittsburgh', 'city', 'US', 'united states', 'north_america', 3),
  ('pk', 'country_iso', 'PK', 'pakistan', 'asia', 2),
  ('pl', 'country_iso', 'PL', 'poland', 'europe', 2),
  ('plano', 'city', 'US', 'united states', 'north_america', 3),
  ('plovdiv', 'city', 'BG', 'bulgaria', 'europe', 3),
  ('plymouth', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('plzen', 'city', 'CZ', 'czechia', 'europe', 3),
  ('plzeň', 'city', 'CZ', 'czechia', 'europe', 3),
  ('podgorica', 'city', 'ME', 'montenegro', 'europe', 3),
  ('poland', 'country', 'PL', 'poland', 'europe', 1),
  ('port elizabeth', 'city', 'ZA', 'south africa', 'africa', 3),
  ('port louis', 'city', 'MU', 'mauritius', 'africa', 3),
  ('port moresby', 'city', 'PG', 'papua new guinea', 'oceania', 3),
  ('port st lucie', 'city', 'US', 'united states', 'north_america', 3),
  ('portland', 'city', 'US', 'united states', 'north_america', 3),
  ('portland or', 'city', 'US', 'united states', 'north_america', 3),
  ('porto', 'city', 'PT', 'portugal', 'europe', 3),
  ('porto alegre', 'city', 'BR', 'brazil', 'south_america', 3),
  ('portsmouth', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('portugal', 'country', 'PT', 'portugal', 'europe', 1),
  ('potsdam', 'city', 'DE', 'germany', 'europe', 3),
  ('powys', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('poznan', 'city', 'PL', 'poland', 'europe', 3),
  ('poznań', 'city', 'PL', 'poland', 'europe', 3),
  ('pr', 'country_iso', 'PR', 'puerto rico', 'north_america', 2),
  ('pr,us', 'state', 'US', 'united states', 'north_america', 5),
  ('prague', 'city', 'CZ', 'czechia', 'europe', 3),
  ('praha', 'city', 'CZ', 'czechia', 'europe', 3),
  ('prc', 'alias', 'CN', 'china', 'asia', 2),
  ('pretoria', 'city', 'ZA', 'south africa', 'africa', 3),
  ('prince edward island,ca', 'state', 'CA', 'canada', 'north_america', 4),
  ('princeton', 'city', 'US', 'united states', 'north_america', 3),
  ('provo', 'city', 'US', 'united states', 'north_america', 3),
  ('provo ut', 'city', 'US', 'united states', 'north_america', 3),
  ('ps', 'country_iso', 'PS', 'palestine', 'asia', 2),
  ('pt', 'country_iso', 'PT', 'portugal', 'europe', 2),
  ('puebla', 'city', 'MX', 'mexico', 'north_america', 3),
  ('puerto rico', 'country', 'PR', 'puerto rico', 'north_america', 1),
  ('puerto rico,us', 'state', 'US', 'united states', 'north_america', 4),
  ('pula', 'city', 'HR', 'croatia', 'europe', 3),
  ('pune', 'city', 'IN', 'india', 'asia', 3),
  ('putrajaya', 'city', 'MY', 'malaysia', 'asia', 3),
  ('puttaux', 'city', 'FR', 'france', 'europe', 3),
  ('py', 'country_iso', 'PY', 'paraguay', 'south_america', 2),
  ('qa', 'country_iso', 'QA', 'qatar', 'asia', 2),
  ('qatar', 'country', 'QA', 'qatar', 'asia', 1),
  ('qc,ca', 'state', 'CA', 'canada', 'north_america', 5),
  ('qingdao', 'city', 'CN', 'china', 'asia', 3),
  ('qld,au', 'state', 'AU', 'australia', 'oceania', 5),
  ('quebec', 'city', 'CA', 'canada', 'north_america', 3),
  ('quebec city', 'city', 'CA', 'canada', 'north_america', 3),
  ('quebec,ca', 'state', 'CA', 'canada', 'north_america', 4),
  ('queens', 'city', 'US', 'united states', 'north_america', 3),
  ('queensland,au', 'state', 'AU', 'australia', 'oceania', 4),
  ('queenstown', 'city', 'NZ', 'new zealand', 'oceania', 3),
  ('queretaro', 'city', 'MX', 'mexico', 'north_america', 3),
  ('querétaro', 'city', 'MX', 'mexico', 'north_america', 3),
  ('quezon city', 'city', 'PH', 'philippines', 'asia', 3),
  ('raanana', 'city', 'IL', 'israel', 'asia', 3),
  ('rabat', 'city', 'MA', 'morocco', 'africa', 3),
  ('raleigh', 'city', 'US', 'united states', 'north_america', 3),
  ('raleigh-durham', 'city', 'US', 'united states', 'north_america', 3),
  ('rawalpindi', 'city', 'PK', 'pakistan', 'asia', 3),
  ('reading', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('recife', 'city', 'BR', 'brazil', 'south_america', 3),
  ('recklinghausen', 'city', 'DE', 'germany', 'europe', 3),
  ('red deer', 'city', 'CA', 'canada', 'north_america', 3),
  ('redmond', 'city', 'US', 'united states', 'north_america', 3),
  ('redwood city', 'city', 'US', 'united states', 'north_america', 3),
  ('regensburg', 'city', 'DE', 'germany', 'europe', 3),
  ('regina', 'city', 'CA', 'canada', 'north_america', 3),
  ('reims', 'city', 'FR', 'france', 'europe', 3),
  ('rendsburg', 'city', 'DE', 'germany', 'europe', 3),
  ('rennes', 'city', 'FR', 'france', 'europe', 3),
  ('reno', 'city', 'US', 'united states', 'north_america', 3),
  ('republic of ireland', 'alias', 'IE', 'ireland', 'europe', 2),
  ('republic of korea', 'alias', 'KR', 'south korea', 'asia', 2),
  ('republic of the congo', 'country', 'CG', 'republic of the congo', 'africa', 1),
  ('research triangle park', 'city', 'US', 'united states', 'north_america', 3),
  ('reston', 'city', 'US', 'united states', 'north_america', 3),
  ('reykjavik', 'city', 'IS', 'iceland', 'europe', 3),
  ('reykjavík', 'city', 'IS', 'iceland', 'europe', 3),
  ('rhode island,us', 'state', 'US', 'united states', 'north_america', 4),
  ('ri,us', 'state', 'US', 'united states', 'north_america', 5),
  ('richmond', 'city', 'US', 'united states', 'north_america', 3),
  ('richmond hill', 'city', 'CA', 'canada', 'north_america', 3),
  ('rijeka', 'city', 'HR', 'croatia', 'europe', 3),
  ('rio', 'city', 'BR', 'brazil', 'south_america', 3),
  ('rio de janeiro', 'city', 'BR', 'brazil', 'south_america', 3),
  ('riverside', 'city', 'US', 'united states', 'north_america', 3),
  ('riyadh', 'city', 'SA', 'saudi arabia', 'asia', 3),
  ('ro', 'country_iso', 'RO', 'romania', 'europe', 2),
  ('rochester', 'city', 'US', 'united states', 'north_america', 3),
  ('rockville', 'city', 'US', 'united states', 'north_america', 3),
  ('roma', 'city', 'IT', 'italy', 'europe', 3),
  ('romania', 'country', 'RO', 'romania', 'europe', 1),
  ('rome', 'city', 'IT', 'italy', 'europe', 3),
  ('rosario', 'city', 'AR', 'argentina', 'south_america', 3),
  ('rostock', 'city', 'DE', 'germany', 'europe', 3),
  ('rotterdam', 'city', 'NL', 'netherlands', 'europe', 3),
  ('rouen', 'city', 'FR', 'france', 'europe', 3),
  ('royal leamington spa', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('rs', 'country_iso', 'RS', 'serbia', 'europe', 2),
  ('ru', 'country_iso', 'RU', 'russia', 'europe', 2),
  ('rungis', 'city', 'FR', 'france', 'europe', 3),
  ('russia', 'country', 'RU', 'russia', 'europe', 1),
  ('russian federation', 'alias', 'RU', 'russia', 'europe', 2),
  ('rw', 'country_iso', 'RW', 'rwanda', 'africa', 2),
  ('rwanda', 'country', 'RW', 'rwanda', 'africa', 1),
  ('sa', 'country_iso', 'SA', 'saudi arabia', 'asia', 2),
  ('sa,au', 'state', 'AU', 'australia', 'oceania', 5),
  ('saarbrucken', 'city', 'DE', 'germany', 'europe', 3),
  ('saarbrücken', 'city', 'DE', 'germany', 'europe', 3),
  ('saarlouis', 'city', 'DE', 'germany', 'europe', 3),
  ('sacramento', 'city', 'US', 'united states', 'north_america', 3),
  ('saigon', 'city', 'VN', 'vietnam', 'asia', 3),
  ('saint john', 'city', 'CA', 'canada', 'north_america', 3),
  ('saint petersburg', 'city', 'RU', 'russia', 'europe', 3),
  ('saint-denis', 'city', 'FR', 'france', 'europe', 3),
  ('saint-ouen', 'city', 'FR', 'france', 'europe', 3),
  ('sakartvelo', 'alias', 'GE', 'georgia', 'asia', 2),
  ('salamanca', 'city', 'ES', 'spain', 'europe', 3),
  ('salem', 'city', 'US', 'united states', 'north_america', 3),
  ('salt lake', 'city', 'US', 'united states', 'north_america', 3),
  ('salt lake city', 'city', 'US', 'united states', 'north_america', 3),
  ('salvador', 'city', 'BR', 'brazil', 'south_america', 3),
  ('salzburg', 'city', 'AT', 'austria', 'europe', 3),
  ('samoa', 'country', 'WS', 'samoa', 'oceania', 1),
  ('san antonio', 'city', 'US', 'united states', 'north_america', 3),
  ('san diego', 'city', 'US', 'united states', 'north_america', 3),
  ('san francisco', 'city', 'US', 'united states', 'north_america', 3),
  ('san francisco bay area', 'city', 'US', 'united states', 'north_america', 3),
  ('san jose', 'city', 'US', 'united states', 'north_america', 3),
  ('san jose costa rica', 'city', 'CR', 'costa rica', 'north_america', 3),
  ('san jose cr', 'city', 'CR', 'costa rica', 'north_america', 3),
  ('san marino', 'country', 'SM', 'san marino', 'europe', 1),
  ('san sebastian', 'city', 'ES', 'spain', 'europe', 3),
  ('sandton', 'city', 'ZA', 'south africa', 'africa', 3),
  ('santa clara', 'city', 'US', 'united states', 'north_america', 3),
  ('santander', 'city', 'ES', 'spain', 'europe', 3),
  ('santiago', 'city', 'CL', 'chile', 'south_america', 3),
  ('santiago de los caballeros', 'city', 'DO', 'dominican republic', 'north_america', 3),
  ('santo domingo', 'city', 'DO', 'dominican republic', 'north_america', 3),
  ('sao paulo', 'city', 'BR', 'brazil', 'south_america', 3),
  ('sapporo', 'city', 'JP', 'japan', 'asia', 3),
  ('sarajevo', 'city', 'BA', 'bosnia and herzegovina', 'europe', 3),
  ('sarasota', 'city', 'US', 'united states', 'north_america', 3),
  ('saskatchewan,ca', 'state', 'CA', 'canada', 'north_america', 4),
  ('saskatoon', 'city', 'CA', 'canada', 'north_america', 3),
  ('saudi arabia', 'country', 'SA', 'saudi arabia', 'asia', 1),
  ('savannah', 'city', 'US', 'united states', 'north_america', 3),
  ('sb', 'country_iso', 'SB', 'solomon islands', 'oceania', 2),
  ('sc', 'country_iso', 'SC', 'seychelles', 'africa', 2),
  ('sc,us', 'state', 'US', 'united states', 'north_america', 5),
  ('scarborough', 'city', 'CA', 'canada', 'north_america', 3),
  ('schweiz', 'alias', 'CH', 'switzerland', 'europe', 2),
  ('scotland', 'alias', 'GB', 'united kingdom', 'europe', 2),
  ('scottsdale', 'city', 'US', 'united states', 'north_america', 3),
  ('sd', 'country_iso', 'SD', 'sudan', 'africa', 2),
  ('sd,us', 'state', 'US', 'united states', 'north_america', 5),
  ('se', 'country_iso', 'SE', 'sweden', 'europe', 2),
  ('seattle', 'city', 'US', 'united states', 'north_america', 3),
  ('selangor', 'city', 'MY', 'malaysia', 'asia', 3),
  ('senegal', 'country', 'SN', 'senegal', 'africa', 1),
  ('seoul', 'city', 'KR', 'south korea', 'asia', 3),
  ('serbia', 'country', 'RS', 'serbia', 'europe', 1),
  ('setubal', 'city', 'PT', 'portugal', 'europe', 3),
  ('setúbal', 'city', 'PT', 'portugal', 'europe', 3),
  ('sevilla', 'city', 'ES', 'spain', 'europe', 3),
  ('seville', 'city', 'ES', 'spain', 'europe', 3),
  ('seychelles', 'country', 'SC', 'seychelles', 'africa', 1),
  ('sg', 'country_iso', 'SG', 'singapore', 'asia', 2),
  ('shah alam', 'city', 'MY', 'malaysia', 'asia', 3),
  ('shanghai', 'city', 'CN', 'china', 'asia', 3),
  ('sharjah', 'city', 'AE', 'united arab emirates', 'asia', 3),
  ('sheffield', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('shenzhen', 'city', 'CN', 'china', 'asia', 3),
  ('sherbrooke', 'city', 'CA', 'canada', 'north_america', 3),
  ('shropshire', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('si', 'country_iso', 'SI', 'slovenia', 'europe', 2),
  ('sibiu', 'city', 'RO', 'romania', 'europe', 3),
  ('siena', 'city', 'IT', 'italy', 'europe', 3),
  ('sierra leone', 'country', 'SL', 'sierra leone', 'africa', 1),
  ('silicon valley', 'city', 'US', 'united states', 'north_america', 3),
  ('sindelfingen', 'city', 'DE', 'germany', 'europe', 3),
  ('singapore', 'city', 'SG', 'singapore', 'asia', 3),
  ('singapore', 'country', 'SG', 'singapore', 'asia', 1),
  ('sk', 'country_iso', 'SK', 'slovakia', 'europe', 2),
  ('sk,ca', 'state', 'CA', 'canada', 'north_america', 5),
  ('skopje', 'city', 'MK', 'north macedonia', 'europe', 3),
  ('sl', 'country_iso', 'SL', 'sierra leone', 'africa', 2),
  ('slough', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('slovakia', 'country', 'SK', 'slovakia', 'europe', 1),
  ('slovenia', 'country', 'SI', 'slovenia', 'europe', 1),
  ('sm', 'country_iso', 'SM', 'san marino', 'europe', 2),
  ('sn', 'country_iso', 'SN', 'senegal', 'africa', 2),
  ('so', 'country_iso', 'SO', 'somalia', 'africa', 2),
  ('soest', 'city', 'DE', 'germany', 'europe', 3),
  ('sofia', 'city', 'BG', 'bulgaria', 'europe', 3),
  ('solihull', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('solomon islands', 'country', 'SB', 'solomon islands', 'oceania', 1),
  ('somalia', 'country', 'SO', 'somalia', 'africa', 1),
  ('somerset', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('south africa', 'country', 'ZA', 'south africa', 'africa', 1),
  ('south australia,au', 'state', 'AU', 'australia', 'oceania', 4),
  ('south carolina,us', 'state', 'US', 'united states', 'north_america', 4),
  ('south dakota,us', 'state', 'US', 'united states', 'north_america', 4),
  ('south korea', 'country', 'KR', 'south korea', 'asia', 1),
  ('south sudan', 'country', 'SS', 'south sudan', 'africa', 1),
  ('south yorkshire', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('southampton', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('spain', 'country', 'ES', 'spain', 'europe', 1),
  ('split', 'city', 'HR', 'croatia', 'europe', 3),
  ('spokane', 'city', 'US', 'united states', 'north_america', 3),
  ('sr', 'country_iso', 'SR', 'suriname', 'south_america', 2),
  ('sri lanka', 'country', 'LK', 'sri lanka', 'asia', 1),
  ('sricity', 'city', 'IN', 'india', 'asia', 3),
  ('ss', 'country_iso', 'SS', 'south sudan', 'africa', 2),
  ('st gallen', 'city', 'CH', 'switzerland', 'europe', 3),
  ('st john''s', 'city', 'CA', 'canada', 'north_america', 3),
  ('st louis', 'city', 'US', 'united states', 'north_america', 3),
  ('st lucie', 'city', 'US', 'united states', 'north_america', 3),
  ('st paul', 'city', 'US', 'united states', 'north_america', 3),
  ('st petersburg', 'city', 'RU', 'russia', 'europe', 3),
  ('staffordshire', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('stamford', 'city', 'US', 'united states', 'north_america', 3),
  ('staten island', 'city', 'US', 'united states', 'north_america', 3),
  ('stavanger', 'city', 'NO', 'norway', 'europe', 3),
  ('stellenbosch', 'city', 'ZA', 'south africa', 'africa', 3),
  ('stockholm', 'city', 'SE', 'sweden', 'europe', 3),
  ('stockton', 'city', 'US', 'united states', 'north_america', 3),
  ('stoke-on-trent', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('strasbourg', 'city', 'FR', 'france', 'europe', 3),
  ('stuttgart', 'city', 'DE', 'germany', 'europe', 3),
  ('stuttgart-vaihingen', 'city', 'DE', 'germany', 'europe', 3),
  ('sudan', 'country', 'SD', 'sudan', 'africa', 1),
  ('sudbury', 'city', 'CA', 'canada', 'north_america', 3),
  ('suffolk', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('suisse', 'alias', 'CH', 'switzerland', 'europe', 2),
  ('sunderland', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('sunnyvale', 'city', 'US', 'united states', 'north_america', 3),
  ('sunshine coast', 'city', 'AU', 'australia', 'oceania', 3),
  ('surabaya', 'city', 'ID', 'indonesia', 'asia', 3),
  ('surat', 'city', 'IN', 'india', 'asia', 3),
  ('suriname', 'country', 'SR', 'suriname', 'south_america', 1),
  ('surprise', 'city', 'US', 'united states', 'north_america', 3),
  ('surrey', 'city', 'CA', 'canada', 'north_america', 3),
  ('sussex', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('suva', 'city', 'FJ', 'fiji', 'oceania', 3),
  ('suzhou', 'city', 'CN', 'china', 'asia', 3),
  ('sv', 'country_iso', 'SV', 'el salvador', 'north_america', 2),
  ('swansea', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('swaziland', 'alias', 'SZ', 'eswatini', 'africa', 2),
  ('sweden', 'country', 'SE', 'sweden', 'europe', 1),
  ('switzerland', 'country', 'CH', 'switzerland', 'europe', 1),
  ('sy', 'country_iso', 'SY', 'syria', 'asia', 2),
  ('sydney', 'city', 'AU', 'australia', 'oceania', 3),
  ('syracuse', 'city', 'US', 'united states', 'north_america', 3),
  ('syria', 'country', 'SY', 'syria', 'asia', 1),
  ('sz', 'country_iso', 'SZ', 'eswatini', 'africa', 2),
  ('szczecin', 'city', 'PL', 'poland', 'europe', 3),
  ('szeged', 'city', 'HU', 'hungary', 'europe', 3),
  ('são paulo', 'city', 'BR', 'brazil', 'south_america', 3),
  ('tacoma', 'city', 'US', 'united states', 'north_america', 3),
  ('taguig', 'city', 'PH', 'philippines', 'asia', 3),
  ('taichung', 'city', 'TW', 'taiwan', 'asia', 3),
  ('tainan', 'city', 'TW', 'taiwan', 'asia', 3),
  ('taipei', 'city', 'TW', 'taiwan', 'asia', 3),
  ('taiwan', 'country', 'TW', 'taiwan', 'asia', 1),
  ('tajikistan', 'country', 'TJ', 'tajikistan', 'asia', 1),
  ('tamil nadu', 'city', 'IN', 'india', 'asia', 3),
  ('tampa', 'city', 'US', 'united states', 'north_america', 3),
  ('tampere', 'city', 'FI', 'finland', 'europe', 3),
  ('tangerang', 'city', 'ID', 'indonesia', 'asia', 3),
  ('tanzania', 'country', 'TZ', 'tanzania', 'africa', 1),
  ('tarragona', 'city', 'ES', 'spain', 'europe', 3),
  ('tas,au', 'state', 'AU', 'australia', 'oceania', 5),
  ('tashkent', 'city', 'UZ', 'uzbekistan', 'asia', 3),
  ('tasmania,au', 'state', 'AU', 'australia', 'oceania', 4),
  ('tauranga', 'city', 'NZ', 'new zealand', 'oceania', 3),
  ('tbilisi', 'city', 'GE', 'georgia', 'asia', 3),
  ('td', 'country_iso', 'TD', 'chad', 'africa', 2),
  ('tel aviv', 'city', 'IL', 'israel', 'asia', 3),
  ('tel aviv-yafo', 'city', 'IL', 'israel', 'asia', 3),
  ('telangana', 'city', 'IN', 'india', 'asia', 3),
  ('tempe', 'city', 'US', 'united states', 'north_america', 3),
  ('tennessee,us', 'state', 'US', 'united states', 'north_america', 4),
  ('texas,us', 'state', 'US', 'united states', 'north_america', 4),
  ('tg', 'country_iso', 'TG', 'togo', 'africa', 2),
  ('th', 'country_iso', 'TH', 'thailand', 'asia', 2),
  ('thailand', 'country', 'TH', 'thailand', 'asia', 1),
  ('thane', 'city', 'IN', 'india', 'asia', 3),
  ('the hague', 'city', 'NL', 'netherlands', 'europe', 3),
  ('the netherlands', 'alias', 'NL', 'netherlands', 'europe', 2),
  ('the philippines', 'alias', 'PH', 'philippines', 'asia', 2),
  ('thessalonica', 'city', 'GR', 'greece', 'europe', 3),
  ('thessaloniki', 'city', 'GR', 'greece', 'europe', 3),
  ('thiruvananthapuram', 'city', 'IN', 'india', 'asia', 3),
  ('thunder bay', 'city', 'CA', 'canada', 'north_america', 3),
  ('tianjin', 'city', 'CN', 'china', 'asia', 3),
  ('tijuana', 'city', 'MX', 'mexico', 'north_america', 3),
  ('tilburg', 'city', 'NL', 'netherlands', 'europe', 3),
  ('timisoara', 'city', 'RO', 'romania', 'europe', 3),
  ('timișoara', 'city', 'RO', 'romania', 'europe', 3),
  ('timor-leste', 'country', 'TL', 'timor-leste', 'asia', 1),
  ('tirana', 'city', 'AL', 'albania', 'europe', 3),
  ('tj', 'country_iso', 'TJ', 'tajikistan', 'asia', 2),
  ('tl', 'country_iso', 'TL', 'timor-leste', 'asia', 2),
  ('tm', 'country_iso', 'TM', 'turkmenistan', 'asia', 2),
  ('tn', 'country_iso', 'TN', 'tunisia', 'africa', 2),
  ('tn,us', 'state', 'US', 'united states', 'north_america', 5),
  ('to', 'country_iso', 'TO', 'tonga', 'oceania', 2),
  ('togo', 'country', 'TG', 'togo', 'africa', 1),
  ('tokyo', 'city', 'JP', 'japan', 'asia', 3),
  ('toledo', 'city', 'ES', 'spain', 'europe', 3),
  ('toluca', 'city', 'MX', 'mexico', 'north_america', 3),
  ('tonga', 'country', 'TO', 'tonga', 'oceania', 1),
  ('toowoomba', 'city', 'AU', 'australia', 'oceania', 3),
  ('torino', 'city', 'IT', 'italy', 'europe', 3),
  ('toronto', 'city', 'CA', 'canada', 'north_america', 3),
  ('toulon', 'city', 'FR', 'france', 'europe', 3),
  ('toulouse', 'city', 'FR', 'france', 'europe', 3),
  ('tours', 'city', 'FR', 'france', 'europe', 3),
  ('townsville', 'city', 'AU', 'australia', 'oceania', 3),
  ('tr', 'country_iso', 'TR', 'turkey', 'asia', 2),
  ('trier', 'city', 'DE', 'germany', 'europe', 3),
  ('trieste', 'city', 'IT', 'italy', 'europe', 3),
  ('trinidad', 'alias', 'TT', 'trinidad and tobago', 'north_america', 2),
  ('trinidad and tobago', 'country', 'TT', 'trinidad and tobago', 'north_america', 1),
  ('trivandrum', 'city', 'IN', 'india', 'asia', 3),
  ('tromso', 'city', 'NO', 'norway', 'europe', 3),
  ('trondheim', 'city', 'NO', 'norway', 'europe', 3),
  ('tt', 'country_iso', 'TT', 'trinidad and tobago', 'north_america', 2),
  ('tucson', 'city', 'US', 'united states', 'north_america', 3),
  ('tulsa', 'city', 'US', 'united states', 'north_america', 3),
  ('tunis', 'city', 'TN', 'tunisia', 'africa', 3),
  ('tunisia', 'country', 'TN', 'tunisia', 'africa', 1),
  ('turin', 'city', 'IT', 'italy', 'europe', 3),
  ('turkey', 'country', 'TR', 'turkey', 'asia', 1),
  ('turkiye', 'alias', 'TR', 'turkey', 'asia', 2),
  ('turkmenistan', 'country', 'TM', 'turkmenistan', 'asia', 1),
  ('turku', 'city', 'FI', 'finland', 'europe', 3),
  ('tw', 'country_iso', 'TW', 'taiwan', 'asia', 2),
  ('tx,us', 'state', 'US', 'united states', 'north_america', 5),
  ('tyne and wear', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('tysons', 'city', 'US', 'united states', 'north_america', 3),
  ('tz', 'country_iso', 'TZ', 'tanzania', 'africa', 2),
  ('türkiye', 'alias', 'TR', 'turkey', 'asia', 2),
  ('ua', 'country_iso', 'UA', 'ukraine', 'europe', 2),
  ('uae', 'alias', 'AE', 'united arab emirates', 'asia', 2),
  ('ug', 'country_iso', 'UG', 'uganda', 'africa', 2),
  ('uganda', 'country', 'UG', 'uganda', 'africa', 1),
  ('uk', 'alias', 'GB', 'united kingdom', 'europe', 2),
  ('ukraine', 'country', 'UA', 'ukraine', 'europe', 1),
  ('ulm', 'city', 'DE', 'germany', 'europe', 3),
  ('united arab emirates', 'country', 'AE', 'united arab emirates', 'asia', 1),
  ('united kingdom', 'country', 'GB', 'united kingdom', 'europe', 1),
  ('united states', 'country', 'US', 'united states', 'north_america', 1),
  ('united states of america', 'alias', 'US', 'united states', 'north_america', 2),
  ('uppsala', 'city', 'SE', 'sweden', 'europe', 3),
  ('uruguay', 'country', 'UY', 'uruguay', 'south_america', 1),
  ('us', 'alias', 'US', 'united states', 'north_america', 2),
  ('us', 'country_iso', 'US', 'united states', 'north_america', 2),
  ('usa', 'alias', 'US', 'united states', 'north_america', 2),
  ('ut,us', 'state', 'US', 'united states', 'north_america', 5),
  ('utah,us', 'state', 'US', 'united states', 'north_america', 4),
  ('utrecht', 'city', 'NL', 'netherlands', 'europe', 3),
  ('uttar pradesh', 'city', 'IN', 'india', 'asia', 3),
  ('uy', 'country_iso', 'UY', 'uruguay', 'south_america', 2),
  ('uz', 'country_iso', 'UZ', 'uzbekistan', 'asia', 2),
  ('uzbekistan', 'country', 'UZ', 'uzbekistan', 'asia', 1),
  ('va,us', 'state', 'US', 'united states', 'north_america', 5),
  ('vadodara', 'city', 'IN', 'india', 'asia', 3),
  ('valencia', 'city', 'ES', 'spain', 'europe', 3),
  ('valladolid', 'city', 'ES', 'spain', 'europe', 3),
  ('valparaiso', 'city', 'CL', 'chile', 'south_america', 3),
  ('valparaíso', 'city', 'CL', 'chile', 'south_america', 3),
  ('vancouver', 'city', 'CA', 'canada', 'north_america', 3),
  ('vancouver wa', 'city', 'US', 'united states', 'north_america', 3),
  ('vandoeuvre-les-nancy', 'city', 'FR', 'france', 'europe', 3),
  ('vantaa', 'city', 'FI', 'finland', 'europe', 3),
  ('vanuatu', 'country', 'VU', 'vanuatu', 'oceania', 1),
  ('varna', 'city', 'BG', 'bulgaria', 'europe', 3),
  ('vaughan', 'city', 'CA', 'canada', 'north_america', 3),
  ('ve', 'country_iso', 'VE', 'venezuela', 'south_america', 2),
  ('venezia', 'city', 'IT', 'italy', 'europe', 3),
  ('venezuela', 'country', 'VE', 'venezuela', 'south_america', 1),
  ('venice', 'city', 'IT', 'italy', 'europe', 3),
  ('vermont,us', 'state', 'US', 'united states', 'north_america', 4),
  ('verona', 'city', 'IT', 'italy', 'europe', 3),
  ('vi,us', 'state', 'US', 'united states', 'north_america', 5),
  ('vic,au', 'state', 'AU', 'australia', 'oceania', 5),
  ('victoria', 'city', 'CA', 'canada', 'north_america', 3),
  ('victoria,au', 'state', 'AU', 'australia', 'oceania', 4),
  ('vienna', 'city', 'AT', 'austria', 'europe', 3),
  ('viet nam', 'alias', 'VN', 'vietnam', 'asia', 2),
  ('vietnam', 'country', 'VN', 'vietnam', 'asia', 1),
  ('vigo', 'city', 'ES', 'spain', 'europe', 3),
  ('villeurbanne', 'city', 'FR', 'france', 'europe', 3),
  ('virgin islands,us', 'state', 'US', 'united states', 'north_america', 4),
  ('virginia beach', 'city', 'US', 'united states', 'north_america', 3),
  ('virginia,us', 'state', 'US', 'united states', 'north_america', 4),
  ('visakhapatnam', 'city', 'IN', 'india', 'asia', 3),
  ('vn', 'country_iso', 'VN', 'vietnam', 'asia', 2),
  ('vt,us', 'state', 'US', 'united states', 'north_america', 5),
  ('vu', 'country_iso', 'VU', 'vanuatu', 'oceania', 2),
  ('wa,au', 'state', 'AU', 'australia', 'oceania', 5),
  ('wa,us', 'state', 'US', 'united states', 'north_america', 5),
  ('wales', 'alias', 'GB', 'united kingdom', 'europe', 2),
  ('warsaw', 'city', 'PL', 'poland', 'europe', 3),
  ('warszawa', 'city', 'PL', 'poland', 'europe', 3),
  ('warwick', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('warwickshire', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('washington', 'city', 'US', 'united states', 'north_america', 3),
  ('washington dc', 'city', 'US', 'united states', 'north_america', 3),
  ('washington,us', 'state', 'US', 'united states', 'north_america', 4),
  ('waterford', 'city', 'IE', 'ireland', 'europe', 3),
  ('waterloo', 'city', 'CA', 'canada', 'north_america', 3),
  ('watford', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('wellington', 'city', 'NZ', 'new zealand', 'oceania', 3),
  ('west bengal', 'city', 'IN', 'india', 'asia', 3),
  ('west glamorgan', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('west midlands', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('west palm beach', 'city', 'US', 'united states', 'north_america', 3),
  ('west sussex', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('west virginia,us', 'state', 'US', 'united states', 'north_america', 4),
  ('west yorkshire', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('western australia,au', 'state', 'AU', 'australia', 'oceania', 4),
  ('whitby', 'city', 'CA', 'canada', 'north_america', 3),
  ('white plains', 'city', 'US', 'united states', 'north_america', 3),
  ('wi,us', 'state', 'US', 'united states', 'north_america', 5),
  ('wichita', 'city', 'US', 'united states', 'north_america', 3),
  ('wien', 'city', 'AT', 'austria', 'europe', 3),
  ('wiesbaden', 'city', 'DE', 'germany', 'europe', 3),
  ('wilmington', 'city', 'US', 'united states', 'north_america', 3),
  ('wiltshire', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('windsor', 'city', 'CA', 'canada', 'north_america', 3),
  ('winnipeg', 'city', 'CA', 'canada', 'north_america', 3),
  ('winterthur', 'city', 'CH', 'switzerland', 'europe', 3),
  ('wisconsin,us', 'state', 'US', 'united states', 'north_america', 4),
  ('wolfsburg', 'city', 'DE', 'germany', 'europe', 3),
  ('wollongong', 'city', 'AU', 'australia', 'oceania', 3),
  ('worcestershire', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('wroclaw', 'city', 'PL', 'poland', 'europe', 3),
  ('wrocław', 'city', 'PL', 'poland', 'europe', 3),
  ('ws', 'country_iso', 'WS', 'samoa', 'oceania', 2),
  ('wuhan', 'city', 'CN', 'china', 'asia', 3),
  ('wuppertal', 'city', 'DE', 'germany', 'europe', 3),
  ('wv,us', 'state', 'US', 'united states', 'north_america', 5),
  ('wy,us', 'state', 'US', 'united states', 'north_america', 5),
  ('wyoming,us', 'state', 'US', 'united states', 'north_america', 4),
  ('xi''an', 'city', 'CN', 'china', 'asia', 3),
  ('xiamen', 'city', 'CN', 'china', 'asia', 3),
  ('xian', 'city', 'CN', 'china', 'asia', 3),
  ('xk', 'country_iso', 'XK', 'kosovo', 'europe', 2),
  ('yangon', 'city', 'MM', 'myanmar', 'asia', 3),
  ('ye', 'country_iso', 'YE', 'yemen', 'asia', 2),
  ('yekaterinburg', 'city', 'RU', 'russia', 'europe', 3),
  ('yemen', 'country', 'YE', 'yemen', 'asia', 1),
  ('yerevan', 'city', 'AM', 'armenia', 'asia', 3),
  ('yokohama', 'city', 'JP', 'japan', 'asia', 3),
  ('york', 'city', 'GB', 'united kingdom', 'europe', 3),
  ('yt,ca', 'state', 'CA', 'canada', 'north_america', 5),
  ('yukon,ca', 'state', 'CA', 'canada', 'north_america', 4),
  ('za', 'country_iso', 'ZA', 'south africa', 'africa', 2),
  ('zaandam', 'city', 'NL', 'netherlands', 'europe', 3),
  ('zadar', 'city', 'HR', 'croatia', 'europe', 3),
  ('zagreb', 'city', 'HR', 'croatia', 'europe', 3),
  ('zambia', 'country', 'ZM', 'zambia', 'africa', 1),
  ('zaragoza', 'city', 'ES', 'spain', 'europe', 3),
  ('zilina', 'city', 'SK', 'slovakia', 'europe', 3),
  ('zimbabwe', 'country', 'ZW', 'zimbabwe', 'africa', 1),
  ('zm', 'country_iso', 'ZM', 'zambia', 'africa', 2),
  ('zug', 'city', 'CH', 'switzerland', 'europe', 3),
  ('zuid-holland', 'city', 'NL', 'netherlands', 'europe', 3),
  ('zurich', 'city', 'CH', 'switzerland', 'europe', 3),
  ('zw', 'country_iso', 'ZW', 'zimbabwe', 'africa', 2),
  ('zwolle', 'city', 'NL', 'netherlands', 'europe', 3),
  ('zürich', 'city', 'CH', 'switzerland', 'europe', 3),
  ('łódź', 'city', 'PL', 'poland', 'europe', 3),
  ('žilina', 'city', 'SK', 'slovakia', 'europe', 3),
  ('大阪市', 'city', 'JP', 'japan', 'asia', 3),
  ('大阪府', 'city', 'JP', 'japan', 'asia', 3),
  ('東京', 'city', 'JP', 'japan', 'asia', 3),
  ('東京都', 'city', 'JP', 'japan', 'asia', 3),
  ('東京都中央区', 'city', 'JP', 'japan', 'asia', 3),
  ('東京都新宿区', 'city', 'JP', 'japan', 'asia', 3),
  ('東京都港区', 'city', 'JP', 'japan', 'asia', 3)
on conflict (token, kind) do update
  set country_code = excluded.country_code,
      country_name = excluded.country_name,
      continent = excluded.continent,
      priority = excluded.priority;

create or replace function public.job_location_normalize(value text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $function$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          replace(replace(
            translate(lower(coalesce(value, '')),
                      'àáâãäåéèêëíìîïóòôõöúùûüçñ',
                      'aaaaaaeeeeiiiiooooouuuucn'),
            'ß', 'ss'),
          'ø', 'o'),
          '\.', '', 'g'),
        '\s+', ' ', 'g'),
      ' '),
    '');
$function$;

create or replace function public.job_country_code(region text)
returns char(2)
language plpgsql
stable
parallel safe
set search_path = public
as $function$
declare
  v text;
  raw text[];
  segs text[] := '{}';
  s text;
  piece text;
  w text;
  words text[];
  i int;
  n int;
  lasttok text;
  g1 text;
  g2 text;
  found text;
  lastcc char(2);
  citycc char(2);
  statecc char(2);
  isocc char(2);
begin
  if region ~ '^[a-zA-Z]{2,3}\.[a-zA-Z]{2}\.' then
    -- "USA.VA.Reston": dotted triples read better as a comma list.
    v := public.job_location_normalize(replace(region, '.', ','));
  else
    v := public.job_location_normalize(region);
  end if;
  if v is null or v = '' then
    return null;
  end if;
  if v = any (array['worldwide', 'remote', 'world wide', 'anywhere', 'global', 'nationwide', 'all cities', 'various locations', 'multiple locations', 'flexible', 'not specified', 'unknown', '未注明', '不限', '远程']) then
    return null;
  end if;

  -- 0c) Workday-style location codes: "US-CT-EAST HARTFORD...",
  --     "CA-QC-LONGUEUIL...", "IN-KA-BENGALURU...".
  if v ~ '^[a-z]{2}-[a-z]{2}-' then
    g1 := split_part(v, '-', 1);
    g2 := split_part(v, '-', 2);
    if g1 = 'us' then
      return 'US';
    end if;
    if g1 = 'ca' and exists (
      select 1 from public.job_country_taxonomy t
       where t.kind = 'state' and t.token = g2 || ',ca'
    ) then
      return 'CA';
    end if;
    select t.country_code into found
      from public.job_country_taxonomy t
     where t.kind = 'country_iso' and t.token = g1;
    if found is not null and not exists (
      select 1 from public.job_country_taxonomy t
       where t.kind = 'state' and t.token = g1 || ',us'
    ) then
      return found;
    end if;
  end if;

  -- Tokenise: split on commas, clean each part, then split on spaced separators.
  raw := string_to_array(v, ',');
  for i in 1 .. coalesce(array_length(raw, 1), 0) loop
    s := btrim(raw[i]);
    -- "ut: south main st" -> "ut"
    if s ~ '^[a-z]{2}:\s' then
      s := substring(s from '^[a-z]{2}');
    end if;
    s := regexp_replace(s, '^\d{4,7}(-\d{4,7})?\s+', '');          -- leading postcode
    s := regexp_replace(s, '\s+\d{4,7}(-\d{4,7})?$', '');          -- trailing postcode
    s := regexp_replace(s, '\s*\([^)]*\)\s*$', '');                -- "(headquarters)"
    s := regexp_replace(
      s,
      '\s*[\s-]+(office|hq|headquarters|corporate|campus|building|bldg|site|facility|fab\s*\d+|area|(metropolitan|metropolitain|metro)\s*area|metro|state)$',
      '');
    -- Twice: "brownsville, wi corporate office" needs both words stripped.
    s := regexp_replace(
      s,
      '\s*[\s-]+(office|hq|headquarters|corporate|campus|building|bldg|site|facility|fab\s*\d+|area|(metropolitan|metropolitain|metro)\s*area|metro|state)$',
      '');
    s := regexp_replace(s, '\s+(bay)$', '');
    s := regexp_replace(
      s,
      '^(greater|all of|the|hybrid|remote-friendly|remote|home\s*-?\s*based|anywhere|any city|location|multiple|various)\s+',
      '');
    s := btrim(btrim(s), ' -/|~');
    if s = '' then
      continue;
    end if;
    foreach piece in array regexp_split_to_array(s, '\s+[-/|~]\s+') loop
      piece := btrim(btrim(piece), ' -/|~');
      if piece <> '' then
        segs := segs || piece;
      end if;
    end loop;
  end loop;

  n := coalesce(array_length(segs, 1), 0);
  if n = 0 then
    return null;
  end if;
  lasttok := segs[n];

  -- 0) A country marker leading the string wins over a city mentioned later:
  --    "france > rungis : miami building" is a French posting, not a US one.
  select t.country_code into found
    from public.job_country_taxonomy t
   where t.kind in ('country', 'alias')
     and t.token = btrim(split_part(segs[1], '>', 1))
   limit 1;
  if found is not null then
    return found;
  end if;

  -- 0b) Parenthesised ISO-2 anywhere: "paris (fr)", "remote (gb)".
  select t.country_code into found
    from public.job_country_taxonomy t
   where t.kind = 'country_iso'
     and t.token = (regexp_match(v, '\(([a-z]{2})\)'))[1]
   limit 1;
  if found is not null then
    return found;
  end if;

  -- 1) Last segment as a country, unless that token is also a US/CA/AU state
  --    ("London, United Kingdom" must not become London, Ontario, while
  --    "Atlanta, Georgia" / "Tbilisi, Georgia" fall through to the city pass).
  if not exists (
    select 1 from public.job_country_taxonomy s2
     where s2.kind = 'state'
       and s2.token = lasttok || ',' || lower(s2.country_code::text)
  ) then
    select t.country_code into lastcc
      from public.job_country_taxonomy t
     where t.kind in ('country', 'alias')
       and t.token = lasttok
     limit 1;
    if lastcc is null and (n >= 3 or v ~ '\([a-z]{2}\)') then
      select t.country_code into lastcc
        from public.job_country_taxonomy t
       where t.kind = 'country_iso' and t.token = lasttok
       limit 1;
    end if;
  end if;
  if lastcc is not null then
    return lastcc;
  end if;

  -- 2) City, right to left. Fixes the historic `Bangalore, IN` -> Indiana
  --    mistake and resolves "City, State, Country" shapes.
  for i in reverse n .. 1 loop
    select t.country_code into citycc
      from public.job_country_taxonomy t
     where t.kind = 'city' and t.token = segs[i]
     limit 1;
    exit when citycc is not null;
  end loop;

  -- 3) State name / postal code, as the last segment or as its last word
  --    ("baldwin ny"). For a two-letter token that is ALSO a country ISO code
  --    (in / ca / de / il) the city pass decides.
  select s2.country_code into statecc
    from public.job_country_taxonomy s2
   where s2.kind = 'state'
     and s2.token = lasttok || ',' || lower(s2.country_code::text)
   order by s2.priority
   limit 1;
  if statecc is null and lasttok ~ '\s[a-z]{2}$' then
    select s2.country_code into statecc
      from public.job_country_taxonomy s2
     where s2.kind = 'state'
       and s2.token = (regexp_match(lasttok, '([a-z]{2})$'))[1] || ',' || lower(s2.country_code::text)
     order by s2.priority
     limit 1;
  end if;
  if statecc is not null then
    if citycc is not null and exists (
      select 1 from public.job_country_taxonomy c
       where c.kind in ('country', 'alias') and c.token = lasttok
    ) then
      return citycc;
    end if;
    if char_length(lasttok) = 2 then
      select t.country_code into isocc
        from public.job_country_taxonomy t
       where t.kind = 'country_iso' and t.token = lasttok
       limit 1;
      if isocc is not null and citycc is not null then
        if citycc = isocc then
          return isocc;
        else
          return statecc;
        end if;
      end if;
    end if;
    return statecc;
  end if;
  if citycc is not null then
    return citycc;
  end if;

  -- 4) Word level: glued shapes like "mississauga ontario canada",
  --    "new york new york united states", "kowloon hong kong".
  words := regexp_split_to_array(v, '[^a-z0-9]+');
  for i in 1 .. coalesce(array_length(words, 1), 0) loop
    w := btrim(words[i]);
    if w = '' then
      continue;
    end if;
    select t.country_code into found
      from public.job_country_taxonomy t
     where t.kind = 'country' and t.token = w
     limit 1;
    if found is not null then
      return found;
    end if;
  end loop;
  if coalesce(array_length(words, 1), 0) >= 2 then
    for i in 1 .. array_length(words, 1) - 1 loop
      select t.country_code into found
        from public.job_country_taxonomy t
       where t.kind in ('country', 'alias')
         and t.token = btrim(words[i]) || ' ' || btrim(words[i + 1])
       limit 1;
      if found is not null then
        return found;
      end if;
    end loop;
    -- 4b) Last word is a US/CA/AU postal code: "baldwin ny" -> US.
    select s2.country_code into found
      from public.job_country_taxonomy s2
     where s2.kind = 'state'
       and s2.token = btrim(words[array_length(words, 1)]) || ',' || lower(s2.country_code::text)
     order by s2.priority
     limit 1;
    if found is not null then
      return found;
    end if;
    -- 4b2) Multi-word city inside a glued string: "san francisco or palo alto",
    --      "avenida ... sao paulo".
    for i in 1 .. array_length(words, 1) - 1 loop
      select t.country_code into found
        from public.job_country_taxonomy t
       where t.kind = 'city'
         and t.token = btrim(words[i]) || ' ' || btrim(words[i + 1])
       limit 1;
      if found is not null then
        return found;
      end if;
    end loop;
  end if;
  -- 4c) Word-level city, right to left.
  for i in reverse coalesce(array_length(words, 1), 0) .. 1 loop
    w := btrim(words[i]);
    if w = '' then
      continue;
    end if;
    select t.country_code into found
      from public.job_country_taxonomy t
     where t.kind = 'city' and t.token = w
     limit 1;
    if found is not null then
      return found;
    end if;
  end loop;

  -- 5) Any segment as a country, then the segment before the last.
  for i in 1 .. n loop
    select t.country_code into found
      from public.job_country_taxonomy t
     where t.kind in ('country', 'alias') and t.token = segs[i]
     limit 1;
    if found is not null then
      return found;
    end if;
  end loop;
  if n > 2 then
    select t.country_code into found
      from public.job_country_taxonomy t
     where t.kind in ('country', 'alias') and t.token = segs[n - 1]
     limit 1;
    if found is not null then
      return found;
    end if;
  end if;

  -- 6) Explicit markers glued into one noisy segment:
  --    "US-CT-EAST HARTFORD-ETC ~ 400 Main St", "Remote - US".
  if v ~ '(^|[^a-z])(usa|u\.s\.a\.?|us|united states|u\.s\.)([^a-z]|$)' then
    return 'US';
  end if;
  if v ~ '(^|[^a-z])(uk|u\.k\.|united kingdom|great britain)([^a-z]|$)' then
    return 'GB';
  end if;
  if v ~ '(^|[^a-z])(uae|u\.a\.e\.)([^a-z]|$)' then
    return 'AE';
  end if;

  return null;
end;
$function$;

comment on function public.job_country_code(text) is
  'D4: region text -> ISO-3166-1 alpha-2 country code, or NULL when the posting has no resolvable country';

create or replace function public.job_region_continent(region text)
returns text
language plpgsql
stable
parallel safe
set search_path = public
as $function$
declare
  v text;
  w text;
  nx text;
  words text[];
  i int;
begin
  v := public.job_location_normalize(region);
  if v is null or v = '' then
    return null;
  end if;
  words := regexp_split_to_array(v, '[^a-z]+');
  for i in 1 .. coalesce(array_length(words, 1), 0) loop
    w := btrim(words[i]);
    if w = '' then
      continue;
    end if;
    nx := case when i < coalesce(array_length(words, 1), 0) then btrim(words[i + 1]) else '' end;
    if w = 'north' and nx = 'america' then
      return 'north_america';
    end if;
    if w = 'south' and nx = 'america' then
      return 'south_america';
    end if;
    if w = 'central' and nx = 'america' then
      return 'north_america';
    end if;
    if w = 'middle' and nx = 'east' then
      return 'asia';
    end if;
    if w in ('europe', 'european') then
      return 'europe';
    end if;
    if w in ('asia', 'asian', 'apac', 'asia pacific') then
      return 'asia';
    end if;
    if w in ('africa', 'african', 'emea') then
      continue;
    end if;
    if w in ('oceania', 'australasia') then
      return 'oceania';
    end if;
  end loop;
  return null;
end;
$function$;

comment on function public.job_region_continent(text) is
  'D4: continent-only fallback for continent-level regions ("North America", "Asia Pacific"); ambiguous groupings (EMEA, APAC, LATAM, Americas) stay NULL on purpose';

alter table public.jobs_v3
  add column if not exists country_code char(2),
  add column if not exists continent text;

create or replace function public.jobs_sync_country_code()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.country_code := public.job_country_code(new.region);
  new.continent := coalesce(
    (select t.continent
       from public.job_country_taxonomy t
      where t.kind = 'country_iso'
        and t.token = lower(new.country_code::text)
      limit 1),
    public.job_region_continent(new.region)
  );
  return new;
end;
$function$;

comment on function public.jobs_sync_country_code() is
  'D4: derive country_code/continent from region on write, on the read table where the shadow path lands';

drop trigger if exists jobs_sync_country_code on public.jobs_v3;
create trigger jobs_sync_country_code
  before insert or update of region on public.jobs_v3
  for each row execute function public.jobs_sync_country_code();

-- Read-path indexes for the all-region listing filters. Partial on is_active
-- because the catalog only lists active rows; the created_at/id tail keeps
-- keyset pagination working without a sort.
create index if not exists jobs_v3_country_active_idx
  on public.jobs_v3 (country_code, created_at desc, id desc) where is_active;
create index if not exists jobs_v3_continent_active_idx
  on public.jobs_v3 (continent, created_at desc, id desc) where is_active;

-- `select v.*` is frozen at view creation and the new columns land before
-- region_market, which CREATE OR REPLACE VIEW cannot reorder: drop and re-create.
drop view if exists public.jobs_listing_v3;
create view public.jobs_listing_v3 as
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

commit;

notify pgrst, 'reload schema';
