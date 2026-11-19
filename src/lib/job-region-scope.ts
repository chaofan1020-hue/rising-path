export const TARGET_REGION_KEYWORDS: Record<string, string[]> = {
  north_america: [
    'North America', 'North-American', 'NorthAmerican', 'Americas',
    'United States', 'USA', 'U.S.', 'Canada',
    // 常见的仅城市/州缩写地址
    'New York', 'San Francisco', 'Los Angeles', 'Seattle', 'Chicago', 'Boston', 'Austin',
    'Dallas', 'Houston', 'Atlanta', 'Denver', 'Miami', 'Philadelphia', 'Washington',
    'Jersey City', 'Newark', 'Palo Alto', 'Mountain View', 'Arlington', 'Raleigh',
    'Charlotte', 'Tampa', 'Orlando', 'Columbus', 'Wilmington', 'Fort Lauderdale',
    'Milwaukee', 'Colorado Springs', 'Baton Rouge', 'Fresno', 'San Antonio', 'Jacksonville',
    'San Diego', 'Toronto', 'Vancouver', 'Ottawa', 'Montreal', 'Mississauga', 'Quebec',
  ],
  australia: ['Australia', 'ANZ', 'Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra', 'Ballarat'],
  hong_kong: ['Hong Kong', 'Kowloon', 'Hong Kong Island'],
  singapore: ['Singapore'],
  united_kingdom: [
    'United Kingdom', 'UK', 'U.K.', 'England', 'Scotland', 'Wales', 'Northern Ireland',
    'London', 'Bournemouth', 'Bristol', 'Manchester', 'Edinburgh', 'Glasgow', 'Birmingham',
    'Leeds', 'Cardiff', 'Belfast', 'Cambridge', 'Oxford', 'Southampton', 'Reading', 'Guildford',
    'Crawley', 'Aberdeen', 'Newcastle', 'Sheffield', 'Liverpool',
  ],
};

// ATS feeds frequently use only a US state or territory abbreviation, for
// example "Albany, NY". Treat those location-only records as US roles without
// expanding database ILIKE filters to ambiguous two-letter abbreviations.
const US_STATE_OR_TERRITORY_CODES = 'al|ak|as|az|ar|ca|co|ct|de|dc|fl|ga|gu|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|mp|oh|ok|or|pa|pr|ri|sc|sd|tn|tx|ut|vt|vi|va|wa|wv|wi|wy';

const TARGET_PATTERNS: Array<[string, RegExp]> = [
  ['north_america', new RegExp(`\\b(north america|north-american|northamerican|americas|united states|usa|u\\.s\\.?|us|canada|new york|san francisco|los angeles|seattle|chicago|boston|austin|dallas|houston|atlanta|denver|miami|philadelphia|washington|jersey city|newark|palo alto|mountain view|arlington|raleigh|charlotte|tampa|orlando|columbus|wilmington|fort lauderdale|milwaukee|colorado springs|baton rouge|fresno|san antonio|jacksonville|san diego|toronto|vancouver|ottawa|montreal|mississauga|quebec|${US_STATE_OR_TERRITORY_CODES})\\b`, 'i')],
  ['australia', /\b(australia|anz|sydney|melbourne|brisbane|perth|adelaide|canberra|ballarat)\b/i],
  ['hong_kong', /\b(hong kong|kowloon|hong kong island)\b/i],
  ['singapore', /\bsingapore\b/i],
  ['united_kingdom', /\b(united kingdom|u\.k\.?|uk|england|scotland|wales|northern ireland|london|bournemouth|bristol|manchester|edinburgh|glasgow|birmingham|leeds|cardiff|belfast|cambridge|oxford|southampton|reading|guildford|crawley|aberdeen|newcastle|sheffield|liverpool)\b/i],
];

export function getTargetRegion(location?: string | null, country?: string | null): string | null {
  const value = `${location || ''} ${country || ''}`.trim();
  if (!value) return null;
  for (const [region, pattern] of TARGET_PATTERNS) {
    if (pattern.test(value)) return region;
  }
  return null;
}

export function isTargetRegion(location?: string | null, country?: string | null): boolean {
  return getTargetRegion(location, country) !== null;
}

export function isExcludedRegion(location?: string | null, country?: string | null): boolean {
  const value = `${location || ''} ${country || ''}`.trim();
  return /\b(germany|france|italy|spain|netherlands|ireland|switzerland|belgium|sweden|denmark|norway|finland|austria|portugal|poland|czech|czechia|luxembourg|greece|romania|hungary|european union|europe|berlin|munich|münchen|dusseldorf|düsseldorf|kronberg|frankfurt|hamburg|amsterdam|brussels|paris|madrid|lisbon|warsaw|bucharest|rome|roma|milan|oslo|stockholm|copenhagen|helsinki|vienna|zurich|geneva|prague|krakow|sevilla|brest)\b/i.test(value);
}

function targetRegionKeywords(): string[] {
  return Object.values(TARGET_REGION_KEYWORDS)
    .flat()
    // PostgREST's `or()` grammar treats commas as clause separators. A raw
    // comma inside an ILIKE value cannot be escaped reliably across client
    // versions, so omit those overly-specific aliases; the surrounding city
    // and country keywords still keep the region covered without breaking the
    // entire query.
    .filter((keyword) => !keyword.includes(','));
}

/**
 * ILIKE patterns shared by the public jobs list and
 * `list_active_company_options`. Keep the SQL twin in
 * `0126_target_region_company_options.sql` in sync.
 */
export function targetRegionIlikePatterns(): string[] {
  return targetRegionKeywords().map((keyword) => `%${keyword.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
}

export function targetRegionPostgrestClauses(): string[] {
  return targetRegionKeywords().map((keyword) => `region.ilike.%${keyword.replace(/[\\%_,()]/g, (character) => `\\${character}`)}%`);
}

const CONFIGURED_REGION_KEYWORDS: Record<string, string[]> = {
  '北美': ['North America', 'North-American', 'NorthAmerican', ...TARGET_REGION_KEYWORDS.north_america],
  '美国': TARGET_REGION_KEYWORDS.north_america.filter((keyword) => !['Canada', 'Toronto', 'Vancouver', 'Ottawa', 'Montreal', 'Mississauga', 'Quebec'].includes(keyword)),
  '加拿大': ['Canada', 'Toronto', 'Vancouver', 'Ottawa', 'Montreal', 'Mississauga', 'Quebec'],
  '英国': TARGET_REGION_KEYWORDS.united_kingdom,
  '澳大利亚': TARGET_REGION_KEYWORDS.australia,
  '香港': TARGET_REGION_KEYWORDS.hong_kong,
  '新加坡': TARGET_REGION_KEYWORDS.singapore,
};

const CONFIGURED_REGION_SCOPE_KEYS: Record<string, string[]> = {
  '北美': ['us', 'canada'],
  '美国': ['us'],
  '加拿大': ['canada'],
  '英国': ['uk'],
  '澳大利亚': ['australia'],
  '香港': ['hong_kong'],
  '新加坡': ['singapore'],
};

/**
 * Indexed listing filters backed by the `jobs_listing` view (migration 0134).
 * `region_market` classifies a single market; `region_group` additionally
 * lumps the United States and Canada together as `north_america`, so every
 * supported market filter is one equality predicate instead of dozens of
 * `region ILIKE` clauses. A multi-value column would force the planner to
 * sort instead of returning rows in `updated_at` order.
 */
export type RegionListingFilter = {
  column: 'region_market' | 'region_group';
  value: string;
};

const REGION_LISTING_FILTERS: Record<string, RegionListingFilter> = {
  '北美': { column: 'region_group', value: 'north_america' },
  '美国': { column: 'region_market', value: 'us' },
  '加拿大': { column: 'region_market', value: 'canada' },
  '英国': { column: 'region_market', value: 'uk' },
  '澳大利亚': { column: 'region_market', value: 'australia' },
  '香港': { column: 'region_market', value: 'hong_kong' },
  '新加坡': { column: 'region_market', value: 'singapore' },
};

/**
 * Collapses the selected market labels into one indexed predicate. Returns
 * `null` when the selection mixes columns or contains a custom configuration
 * value; callers then keep the legacy ILIKE behavior for full compatibility.
 */
export function configuredRegionListingFilter(regions: string[]): RegionListingFilter | null {
  if (regions.length === 0) return null;
  let filter: RegionListingFilter | null = null;
  for (const region of regions) {
    const candidate = REGION_LISTING_FILTERS[region.trim()];
    if (!candidate) return null;
    if (filter && filter.column !== candidate.column) return null;
    filter = candidate;
  }
  return filter;
}

/** Stable database values used by the AI-match retrieval RPC. */
export function configuredRegionScopeKeys(regions: string[]): string[] {
  return [...new Set(regions.flatMap((region) => CONFIGURED_REGION_SCOPE_KEYS[region.trim()] || []))];
}

export function targetRegionScopeKeys(): string[] {
  return ['us', 'canada', 'uk', 'australia', 'hong_kong', 'singapore'];
}

function escapePostgrestLike(value: string): string {
  return value.replace(/[\\%_,()]/g, (character) => `\\${character}`);
}

/**
 * Converts the user-facing market labels into the city/country strings stored
 * by job feeds. Keep the raw value too, so custom administrator config values
 * remain usable without a code deployment.
 */
export function configuredRegionPostgrestClauses(regions: string[]): string[] {
  const clauses = new Set<string>();
  for (const region of regions) {
    const value = region.trim();
    if (!value) continue;
    for (const keyword of [value, ...(CONFIGURED_REGION_KEYWORDS[value] || [])]) {
      clauses.add(`region.ilike.%${escapePostgrestLike(keyword)}%`);
    }
  }
  return [...clauses];
}

/** SQL ILIKE patterns for the database-side AI match candidate retrieval. */
export function configuredRegionSearchPatterns(regions: string[]): string[] {
  const patterns = new Set<string>();
  for (const region of regions) {
    const value = region.trim();
    if (!value) continue;
    for (const keyword of [value, ...(CONFIGURED_REGION_KEYWORDS[value] || [])]) {
      patterns.add(`%${keyword.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
    }
  }
  return [...patterns];
}

export function targetRegionSearchPatterns(): string[] {
  return targetRegionIlikePatterns();
}
