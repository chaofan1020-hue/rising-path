export const TARGET_REGION_KEYWORDS: Record<string, string[]> = {
  north_america: [
    'United States', 'USA', 'U.S.', 'Canada',
    // 常见的仅城市/州缩写地址
    'New York', 'San Francisco', 'Los Angeles', 'Seattle', 'Chicago', 'Boston', 'Austin',
    'Dallas', 'Houston', 'Atlanta', 'Denver', 'Miami', 'Philadelphia', 'Washington',
    'Jersey City', 'Newark', 'Palo Alto', 'Mountain View', 'Arlington', 'Raleigh',
    'Charlotte', 'Tampa', 'Orlando', 'Columbus', 'Wilmington', 'Fort Lauderdale',
    'Milwaukee', 'Colorado Springs', 'Baton Rouge', 'Fresno', 'San Antonio', 'Jacksonville',
    'San Diego', 'Toronto', 'Vancouver', 'Ottawa', 'Montreal', 'Mississauga', 'Quebec',
  ],
  australia: ['Australia', 'Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra', 'Ballarat'],
  hong_kong: ['Hong Kong', 'Kowloon', 'Hong Kong Island'],
  united_kingdom: [
    'United Kingdom', 'UK', 'U.K.', 'England', 'Scotland', 'Wales', 'Northern Ireland',
    'London', 'Bournemouth', 'Bristol', 'Manchester', 'Edinburgh', 'Glasgow', 'Birmingham',
    'Leeds', 'Cardiff', 'Belfast', 'Cambridge', 'Oxford', 'Southampton', 'Reading', 'Guildford',
    'Crawley', 'Aberdeen', 'Newcastle', 'Sheffield', 'Liverpool',
  ],
};

const TARGET_PATTERNS: Array<[string, RegExp]> = [
  ['north_america', /\b(united states|usa|u\.s\.?|us|canada|new york|san francisco|los angeles|seattle|chicago|boston|austin|dallas|houston|atlanta|denver|miami|philadelphia|washington|jersey city|newark|palo alto|mountain view|arlington|raleigh|charlotte|tampa|orlando|columbus|wilmington|fort lauderdale|milwaukee|colorado springs|baton rouge|fresno|san antonio|jacksonville|san diego|toronto|vancouver|ottawa|montreal|mississauga|quebec)\b/i],
  ['australia', /\b(australia|sydney|melbourne|brisbane|perth|adelaide|canberra|ballarat)\b/i],
  ['hong_kong', /\b(hong kong|kowloon|hong kong island)\b/i],
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

export function targetRegionPostgrestClauses(): string[] {
  return Object.values(TARGET_REGION_KEYWORDS)
    .flat()
    .map((keyword) => `region.ilike.%${keyword.replace(/[\\%_,()]/g, (character) => `\\${character}`)}%`);
}

const CONFIGURED_REGION_KEYWORDS: Record<string, string[]> = {
  '美国': TARGET_REGION_KEYWORDS.north_america.filter((keyword) => !['Canada', 'Toronto', 'Vancouver', 'Ottawa', 'Montreal', 'Mississauga', 'Quebec'].includes(keyword)),
  '加拿大': ['Canada', 'Toronto', 'Vancouver', 'Ottawa', 'Montreal', 'Mississauga', 'Quebec'],
  '英国': TARGET_REGION_KEYWORDS.united_kingdom,
  '澳大利亚': TARGET_REGION_KEYWORDS.australia,
  '香港': TARGET_REGION_KEYWORDS.hong_kong,
  '新加坡': ['Singapore'],
};

const CONFIGURED_REGION_SCOPE_KEYS: Record<string, string> = {
  '美国': 'us',
  '加拿大': 'canada',
  '英国': 'uk',
  '澳大利亚': 'australia',
  '香港': 'hong_kong',
  '新加坡': 'singapore',
};

/** Stable database values used by the AI-match retrieval RPC. */
export function configuredRegionScopeKeys(regions: string[]): string[] {
  return [...new Set(regions.map((region) => CONFIGURED_REGION_SCOPE_KEYS[region.trim()]).filter(Boolean))];
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
  return Object.values(TARGET_REGION_KEYWORDS)
    .flat()
    .map((keyword) => `%${keyword.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
}
