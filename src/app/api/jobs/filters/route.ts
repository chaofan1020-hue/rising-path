import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireJobAccess } from '@/lib/job-access';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// The facet list only changes as the catalog grows, so a warm process can serve
// it for minutes. Counts are deliberately approximate between refreshes; the
// listing itself always re-counts on the server.
const CACHE_TTL_MS = 10 * 60 * 1000;

type ContinentFacet = {
  value: string;
  label: string;
  jobs: number;
  countries: number;
};

type CountryFacet = {
  code: string;
  name: string;
  continent: string;
  jobs: number;
};

type FilterFacets = {
  continents: ContinentFacet[];
  countries: CountryFacet[];
  unplaced: number;
  total: number;
  generated_at: string;
};

// Fixed display order: the markets this product actually targets first, then
// the rest of the world by volume.
const CONTINENT_ORDER = ['north_america', 'europe', 'asia', 'oceania', 'south_america', 'africa'];
const CONTINENT_LABELS: Record<string, string> = {
  north_america: '北美',
  south_america: '南美',
  europe: '欧洲',
  asia: '亚洲',
  africa: '非洲',
  oceania: '大洋洲',
};

let cached: { at: number; facets: FilterFacets } | null = null;

// Taxonomy country names are stored lowercase (they double as resolver tokens),
// so title-case them for display: "united states" -> "United States".
const NAME_MINOR_WORDS = new Set(['and', 'of', 'the', 'de', 'du', 'del']);
function toDisplayName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => (
      index > 0 && NAME_MINOR_WORDS.has(word)
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1)
    ))
    .join(' ');
}

type CountRow = { continent: string | null; country_code: string | null; country_name: string | null; jobs: number | string };

export async function GET(request: NextRequest) {
  try {
    const denied = await requireJobAccess(request);
    if (denied) return denied;

    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json(cached.facets, {
        headers: { 'Cache-Control': 'private, max-age=60' },
      });
    }

    const client = getSupabaseClient();
    const [countsResult, unplacedResult] = await Promise.all([
      client.rpc('job_country_filter_counts'),
      client.rpc('job_unplaced_count'),
    ]);

    if (countsResult.error) {
      // Rolling deploy ahead of migration 0162 (or a read-switch rollback):
      // the picker simply shows no facets yet, the listing keeps working.
      const missing = countsResult.error.code === 'PGRST202'
        || countsResult.error.code === '42883'
        || /could not find the function|does not exist/i.test(countsResult.error.message || '');
      if (missing) {
        return NextResponse.json(
          { continents: [], countries: [], unplaced: 0, total: 0, generated_at: new Date().toISOString(), unavailable: true },
          { headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
        );
      }
      throw new Error(`读取地区筛选项失败: ${countsResult.error.message}`);
    }

    const rows = (countsResult.data ?? []) as CountRow[];
    const countries: CountryFacet[] = [];
    const byContinent = new Map<string, { jobs: number; countries: number }>();
    for (const row of rows) {
      const code = String(row.country_code || '').toUpperCase();
      if (!/^[A-Z]{2}$/.test(code)) continue;
      const jobs = Number(row.jobs) || 0;
      const continent = row.continent || '';
      countries.push({
        code,
        name: toDisplayName(row.country_name || code),
        continent,
        jobs,
      });
      const bucket = byContinent.get(continent) ?? { jobs: 0, countries: 0 };
      bucket.jobs += jobs;
      bucket.countries += 1;
      byContinent.set(continent, bucket);
    }
    countries.sort((a, b) => b.jobs - a.jobs || a.name.localeCompare(b.name));

    const continents: ContinentFacet[] = [...byContinent.entries()]
      .map(([value, bucket]) => ({
        value,
        label: CONTINENT_LABELS[value] || value,
        jobs: bucket.jobs,
        countries: bucket.countries,
      }))
      .sort((a, b) => {
        const aIndex = CONTINENT_ORDER.indexOf(a.value);
        const bIndex = CONTINENT_ORDER.indexOf(b.value);
        if (aIndex !== bIndex) {
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          return aIndex - bIndex;
        }
        return b.jobs - a.jobs;
      });

    const placed = countries.reduce((sum, country) => sum + country.jobs, 0);
    const unplaced = Number(unplacedResult.data) || 0;
    const facets: FilterFacets = {
      continents,
      countries,
      unplaced,
      total: placed + unplaced,
      generated_at: new Date().toISOString(),
    };
    cached = { at: Date.now(), facets };

    return NextResponse.json(facets, {
      headers: { 'Cache-Control': 'private, max-age=60' },
    });
  } catch (error) {
    console.error('Error building job filter facets:', error);
    return NextResponse.json({ error: '读取地区筛选项失败' }, { status: 500 });
  }
}