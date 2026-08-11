export const TARGET_REGION_KEYWORDS: Record<string, string[]> = {
  north_america: [
    'United States', 'USA', 'U.S.', 'Canada', 'Mexico',
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
  europe: [
    'Germany', 'France', 'Italy', 'Spain', 'Netherlands', 'Ireland', 'Switzerland',
    'Belgium', 'Sweden', 'Denmark', 'Norway', 'Finland', 'Austria', 'Portugal',
    'Poland', 'Czech', 'Czechia', 'Luxembourg', 'Greece', 'Romania', 'Hungary', 'European Union', 'Europe',
    // 常见的仅城市地址
    'Berlin', 'Munich', 'München', 'Dusseldorf', 'Düsseldorf', 'Kronberg', 'Frankfurt', 'Hamburg',
    'Amsterdam', 'Brussels', 'Paris', 'Madrid', 'Lisbon', 'Warsaw', 'Bucharest', 'Rome', 'Roma',
    'Milan', 'Oslo', 'Stockholm', 'Copenhagen', 'Helsinki', 'Vienna', 'Zurich', 'Geneva',
    'Prague', 'Krakow', 'Sevilla', 'Brest',
  ],
};

const TARGET_PATTERNS: Array<[string, RegExp]> = [
  ['north_america', /\b(united states|usa|u\.s\.?|us|canada|mexico|new york|san francisco|los angeles|seattle|chicago|boston|austin|dallas|houston|atlanta|denver|miami|philadelphia|washington|jersey city|newark|palo alto|mountain view|arlington|raleigh|charlotte|tampa|orlando|columbus|wilmington|fort lauderdale|milwaukee|colorado springs|baton rouge|fresno|san antonio|jacksonville|san diego|toronto|vancouver|ottawa|montreal|mississauga|quebec)\b/i],
  ['australia', /\b(australia|sydney|melbourne|brisbane|perth|adelaide|canberra|ballarat)\b/i],
  ['hong_kong', /\b(hong kong|kowloon|hong kong island)\b/i],
  ['united_kingdom', /\b(united kingdom|u\.k\.?|uk|england|scotland|wales|northern ireland|london|bournemouth|bristol|manchester|edinburgh|glasgow|birmingham|leeds|cardiff|belfast|cambridge|oxford|southampton|reading|guildford|crawley|aberdeen|newcastle|sheffield|liverpool)\b/i],
  ['europe', /\b(germany|france|italy|spain|netherlands|ireland|switzerland|belgium|sweden|denmark|norway|finland|austria|portugal|poland|czech|czechia|luxembourg|greece|romania|hungary|european union|europe|berlin|munich|münchen|dusseldorf|düsseldorf|kronberg|frankfurt|hamburg|amsterdam|brussels|paris|madrid|lisbon|warsaw|bucharest|rome|roma|milan|oslo|stockholm|copenhagen|helsinki|vienna|zurich|geneva|prague|krakow|sevilla|brest)\b/i],
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

export function targetRegionPostgrestClauses(): string[] {
  return Object.values(TARGET_REGION_KEYWORDS)
    .flat()
    .map((keyword) => `region.ilike.%${keyword.replace(/[\\%_,()]/g, (character) => `\\${character}`)}%`);
}
