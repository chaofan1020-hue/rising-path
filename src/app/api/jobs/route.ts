import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { detectSponsorship } from '@/lib/utils';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { isDisplayableJobDescription, sanitizeJobContent } from '@/lib/job-content';
import { TARGET_REGION_KEYWORDS, configuredRegionListingFilter, targetRegionPostgrestClauses } from '@/lib/job-region-scope';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';
import { resolveDisplayLogoUrls } from '@/lib/company-logo';
import { isVerifiedField } from '@/lib/job-field-provenance';
import { isDisplayableJobDeadline } from '@/lib/job-deadline';
import { requireJobAccess } from '@/lib/job-access';
import { jobListingReadTable, jobReadTable } from '@/lib/job-read-source';
import { jobWriteTable } from '@/lib/job-write-source';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Keep only logos seen on the current result pages in memory. Loading the
// entire company_logos table before every cold jobs request added an extra
// round trip without improving the response for most pages.
const localLogosCache: Record<string, string> = {};
// Rolling deploys can briefly serve this code before/after the matching
// migration. Remember when an indexed structure is unusable and retry it after
// a short backoff. A permanent flag would keep the slow fallback forever after
// a single transient PostgREST schema-cache miss during a reload.
let listingViewRetryAt = 0;
let regionListingRetryAt = 0;
let targetRegionRetryAt = 0;
let countryIndexRetryAt = 0;
const STRUCTURE_RETRY_MS = 10 * 60 * 1000;
const SCHEMA_CACHE_RETRY_MS = 60 * 1000;

const SUMMARY_COLUMNS = 'id,title,company,region,direction,audience,job_type,employment_category,experience_min_years,experience_max_years,experience_text,description,salary_range,employment_type,workplace_type,job_url,sponsorship,valid_through,deadline_time_zone,deadline_source,salary_source,location_source,field_evidence,is_active,is_closed,posted_at,created_at,updated_at';
const DETAIL_COLUMNS = 'id,title,company,region,direction,audience,job_type,employment_category,experience_min_years,experience_max_years,experience_text,description,requirements,salary_range,employment_type,workplace_type,job_url,sponsorship,valid_through,deadline_time_zone,deadline_source,salary_source,location_source,field_evidence,is_active,is_closed,posted_at,created_at,updated_at';

// 地区映射：将具体地区映射到所属大地区
const regionMapping: Record<string, string> = {
  'North America': '北美',
  // 美国主要城市
  'San Francisco, CA': '美国',
  'Seattle, WA': '美国',
  'New York, NY': '美国',
  'Los Angeles, CA': '美国',
  'Austin, TX': '美国',
  'Boston, MA': '美国',
  'Chicago, IL': '美国',
  'Denver, CO': '美国',
  'Atlanta, GA': '美国',
  'Remote - United States': '美国',
  'United States': '美国',
  // 英国
  'London, UK': '英国',
  'United Kingdom': '英国',
  // 加拿大
  'Toronto, ON': '加拿大',
  'Vancouver, BC': '加拿大',
  'Canada': '加拿大',
  // 澳大利亚
  'Sydney, NSW': '澳大利亚',
  'Melbourne, VIC': '澳大利亚',
  'Australia': '澳大利亚',
  // 香港
  'Hong Kong': '香港',
  // 新加坡
  'Singapore': '新加坡',
};

const regionKeywords: Record<string, string[]> = {
  // 北美是美国、加拿大以及官方直接标注 North America 的合并筛选。
  '北美': TARGET_REGION_KEYWORDS.north_america,
  // Keep these lists broad because the feed contains both country-qualified
  // locations ("New York, NY, United States") and city-only locations.
  '美国': [
    'United States', 'United States of America', 'USA', 'U.S.',
    'New York', 'San Francisco', 'Los Angeles', 'Seattle', 'Chicago', 'Boston',
    'Austin', 'Dallas', 'Houston', 'Atlanta', 'Denver', 'Miami', 'Philadelphia',
    'Washington', 'Jersey City', 'Newark', 'Palo Alto', 'Mountain View', 'Arlington',
    'Raleigh', 'Charlotte', 'Tampa', 'Orlando', 'Columbus', 'Wilmington',
    'Fort Lauderdale', 'Milwaukee', 'Colorado Springs', 'Baton Rouge', 'Fresno',
    'San Antonio', 'Jacksonville', 'San Diego', 'Irvine', 'Princeton', 'St. Louis',
    'Minneapolis', 'Detroit', 'Phoenix', 'Portland', 'Salt Lake City', 'Nashville',
    'Pittsburgh', 'Cleveland', 'Baltimore', 'Remote - United States',
  ],
  '英国': [
    'United Kingdom', 'UK', 'U.K.', 'England', 'Scotland', 'Wales', 'Northern Ireland',
    'London', 'Bournemouth', 'Bristol', 'Manchester', 'Edinburgh', 'Glasgow',
    'Birmingham', 'Leeds', 'Cardiff', 'Belfast', 'Cambridge', 'Oxford', 'Southampton',
    'Reading', 'Guildford', 'Crawley', 'Aberdeen', 'Newcastle', 'Sheffield', 'Liverpool',
  ],
  '加拿大': [
    'Canada', 'Toronto', 'Vancouver', 'Ottawa', 'Montreal', 'Mississauga', 'Quebec',
    'Calgary', 'Edmonton', 'Waterloo', 'Halifax', 'Winnipeg', 'Victoria',
  ],
  '澳大利亚': [
    'Australia', 'Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra',
    'Ballarat', 'Gold Coast', 'Newcastle, NSW', 'Hobart', 'Darwin',
  ],
  '香港': ['Hong Kong', 'Kowloon', 'Hong Kong Island'],
  '新加坡': ['Singapore'],
};

// 方向映射：将子方向映射到父方向（SDE 包含所有工程方向）
const directionMapping: Record<string, string> = {
  // SDE 是大类，包含所有软件工程方向
  'SDE': 'SDE',
  'Fullstack': 'SDE',
  'Frontend': 'SDE',
  'Backend': 'SDE',
  'Mobile': 'SDE',

  // 方向映射
  'MLE': 'ML/AI',
  'Research': 'ML/AI',
  'Marketing': 'MKT',
  'Finance': 'Finance',
  'Legal': 'Legal',
  'Design': 'Design',
  'Risk': 'Risk',
  'Quant': 'Quant',
  'PM': 'PM',
  'Data': 'Data',
  'IBD/S&T': 'IBD/S&T',
  'Consulting': 'Consulting',
  'Hardware': 'Hardware',
  'Security': 'Security',
};
function getRegionCategory(region: string): string {
  return regionMapping[region] || region;
}

// 获取岗位所属的方向大类
function getDirectionCategory(direction: string): string {
  return directionMapping[direction] || direction;
}

function expandMappedValues(values: string[], mapping: Record<string, string>): string[] {
  const expanded = new Set(values);
  for (const [specific, category] of Object.entries(mapping)) {
    if (values.includes(category)) expanded.add(specific);
  }
  return [...expanded];
}

function escapePostgrestSearchTerm(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/[(),]/g, (character) => `\\${character}`)
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

function compactListDescription(value: unknown): string {
  if (typeof value !== 'string') return '';
  const maxLength = 480;
  const normalized = value.trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trim()}…`
    : normalized;
}

function isEntryLevelJobCompatible(job: Record<string, unknown>): boolean {
  const min = typeof job.experience_min_years === 'number'
    ? job.experience_min_years
    : Number(job.experience_min_years);
  const max = typeof job.experience_max_years === 'number'
    ? job.experience_max_years
    : Number(job.experience_max_years);
  if (Number.isFinite(min) && min > 1) return false;
  if (Number.isFinite(max) && max > 1 && Number.isFinite(min) && min > 1) return false;

  // Keep a defensive text check for legacy rows whose numeric experience was
  // never parsed. It only matches explicit years-of-experience requirements,
  // not incidental mentions such as "three years of product history".
  const text = [job.experience_text, job.title, job.description, job.requirements]
    .map((value) => typeof value === 'string' ? value : '')
    .join(' ')
    .replace(/\s+/g, ' ');
  // Titles are often the only structured signal on legacy rows. A clearly
  // senior/management title is incompatible with an internship or campus
  // result even when its experience field was never parsed.
  if (/\b(?:senior|sr\.?|lead|principal|staff|manager|director|vice\s+president|vp|head\s+of|chief)\b/i.test(String(job.title || ''))) return false;
  return !/(?:at\s+least|minimum(?:\s+of)?|requires?|must\s+have|\bof)\s*(?:\d+(?:\.\d+)?\s*\+?|\d+(?:\.\d+)?\s*(?:-|to|–|—)\s*\d+(?:\.\d+)?)\s*(?:years?|yrs?|年)\s*(?:of\s+)?(?:professional\s+)?experience\b/i.test(text);
}

type ListingQueryOptions = {
  listingView: boolean;
  regionIndex: boolean;
  targetIndex: boolean;
  countryIndex: boolean;
};

// D4/D5: country and continent live on `jobs_v3` only (see migration 0161), so
// they are unusable while the read switch is off and the archive path still
// reads `public.jobs`. They also have to degrade on their own when a rolling
// deploy serves this code before the migration lands.
const FILTER_CONTINENTS = new Set(['north_america', 'south_america', 'europe', 'asia', 'africa', 'oceania']);

function parseCountryFilter(values: string[]): string[] {
  const codes = new Set<string>();
  for (const value of values) {
    for (const part of value.split(',')) {
      const code = part.trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(code)) codes.add(code);
    }
  }
  return [...codes];
}

function parseContinentFilter(values: string[]): string[] {
  const continents = new Set<string>();
  for (const value of values) {
    for (const part of value.split(',')) {
      const name = part.trim().toLowerCase();
      if (FILTER_CONTINENTS.has(name)) continents.add(name);
    }
  }
  return [...continents];
}

function detectMissingStructure(error: { code?: string; message?: string }): 'view' | 'region' | 'target' | 'country' | null {
  const code = error.code || '';
  const message = error.message || '';
  // 42P01 undefined_table, 42703 undefined_column, PGRST204/205 schema cache.
  if (code === '42P01' || code === 'PGRST205' || /jobs_listing|relation .* does not exist/i.test(message)) {
    return 'view';
  }
  if (code === '42703' || code === 'PGRST204') {
    if (/region_market|region_group/i.test(message)) return 'region';
    if (/matches_target_region/i.test(message)) return 'target';
    if (/country_code|continent/i.test(message)) return 'country';
  }
  return null;
}

function isStatementTimeout(error: { code?: string; message?: string }): boolean {
  return error.code === '57014' || /statement timeout|canceling statement/i.test(error.message || '');
}

export async function GET(request: NextRequest) {
  try {
    // 未登录访客不返回岗位数据（页面已跳登录页，接口也必须一致）
    const denied = await requireJobAccess(request);
    if (denied) return denied;
    const client = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;

    // 获取多选参数（地区和方向支持多选）
    const regions = searchParams.getAll('region');
    const directions = searchParams.getAll('direction');
    const audience = searchParams.get('audience');
    const jobType = searchParams.get('job_type');
    const sponsorship = searchParams.get('sponsorship');
    const status = searchParams.get('status') || 'active';
    // D5: the catalog now holds every region, so the default listing must not
    // hide non-target postings any more. `region_scope=target` stays available
    // as an explicit opt-in (AI match scoping still uses the target index).
    const regionScope = searchParams.get('region_scope') || 'all';
    const countries = parseCountryFilter(searchParams.getAll('country'));
    const continents = parseContinentFilter(searchParams.getAll('continent'));
    // An explicit country/continent pick is a complete geography statement: it
    // replaces (not combines with) the default target-region narrowing.
    const explicitGeo = countries.length > 0 || continents.length > 0;
    const search = searchParams.get('search')?.trim() || '';
    const summaryOnly = searchParams.get('summary') === '1';
    const exactCompanies = searchParams.getAll('company_exact').map((value) => value.trim()).filter(Boolean);
    const diverseFeed = searchParams.get('diverse') === '1';
    const limit = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');
    const requestedLimit = Number.parseInt(limit || '100', 10);
    const pageLimit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 200) : 100;
    const requestedOffset = Number.parseInt(offsetParam || '0', 10);
    const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0;

    const company = searchParams.get('company')?.trim() || '';
    const targetScopeRequested = regions.length === 0 && !explicitGeo && regionScope !== 'all';
    const entryLevelFilter = jobType === '实习' || jobType === '校招';
    const rangeEnd = entryLevelFilter ? offset + (pageLimit * 3) : offset + pageLimit;
    const regionListingFilter = configuredRegionListingFilter(regions);

    // A planner estimate was 19 % off on the unfiltered catalogue (268,813 shown
    // while the facet panel next to it said 330,449), so the two disagreed.
    // Exact counts cost 15-160 ms as long as an index serves every predicate
    // (jobs_v3_active_display_idx and friends); they only get expensive when a
    // text or ILIKE predicate forces a scan, which is the case the original
    // planned-count comment warned about. So: exact when everything is
    // indexable, planned otherwise.
    const textFiltered = Boolean(search) || Boolean(company) || exactCompanies.length > 0;
    const regionTextScan = regions.length > 0 && !regionListingFilter;
    const exactCountSafe = !textFiltered && !regionTextScan && !entryLevelFilter;

    // Keep the public listing usable while a deployment is applying the target
    // region / listing view migration. The indexed path is fast; the fallback
    // uses the older schema and is only triggered when the response proves the
    // structure is missing.
    const buildQuery = (options: ListingQueryOptions) => {
      // Supabase's generated select parser requires a literal column string;
      // the route intentionally chooses one of two fixed projections here.
      // A planner count avoids scanning the whole jobs table on every filter
      // change, which is what pushed filtered requests over Supabase's
      // statement timeout. It is sufficient for pagination and is marked as
      // estimated in the response. Widen the projection to `string` so the
      // generated parser does not instantiate a union of both row shapes.
      const columns: string = summaryOnly ? SUMMARY_COLUMNS : DETAIL_COLUMNS;
      // C2 (0163) backfilled the ~99k historical closed rows into jobs_v3 and made
      // the two tables dual-write, so the archive no longer needs to bypass the
      // read switch. Until 0163 landed this branch read public.jobs directly;
      // keeping it would now split the catalogue across two tables again.
      let query = client
        .from(options.listingView ? jobListingReadTable() : jobReadTable())
        .select(columns, { count: exactCountSafe ? 'exact' : 'planned' });

      if (diverseFeed) {
        query = query
          .order('updated_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .order('id', { ascending: false });
      } else {
        query = query
          .order('created_at', { ascending: false })
          .order('id', { ascending: false });
      }

      if (status === 'closed') query = query.eq('is_active', false);
      else if (status !== 'all') query = query.eq('is_active', true);
      // Stale is a display state, not a lifecycle state. Hide it from the
      // default catalog while keeping the row (and detail page) reachable.
      if (status !== 'all') query = query.in('display_status', ['listed', 'enriched']);

      if (audience && audience !== '全部') query = query.eq('audience', audience);
      if (jobType && jobType !== '全部') query = query.eq('job_type', jobType);
      if (sponsorship && sponsorship !== '全部') query = query.eq('sponsorship', sponsorship);
      if (exactCompanies.length > 0) query = query.in('company', exactCompanies);
      if (company) query = query.ilike('company', `%${escapePostgrestSearchTerm(company)}%`);

      if (search) {
        const safeSearch = escapePostgrestSearchTerm(search);
        query = query.or(`title.ilike.%${safeSearch}%,company.ilike.%${safeSearch}%`);
      }

      if (regions.length > 0) {
        if (regionListingFilter && options.regionIndex) {
          query = query.eq(regionListingFilter.column, regionListingFilter.value);
        } else {
          const regionClauses = new Set<string>();
          for (const region of regions) {
            const keywords = regionKeywords[region] || [];
            for (const keyword of keywords) {
              regionClauses.add(`region.ilike.%${escapePostgrestSearchTerm(keyword)}%`);
            }
            if (keywords.length === 0) {
              for (const value of expandMappedValues([region], regionMapping)) {
                regionClauses.add(`region.eq.${escapePostgrestSearchTerm(value)}`);
              }
            }
          }
          if (regionClauses.size > 0) query = query.or([...regionClauses].join(','));
        }
      } else if (!explicitGeo && regionScope !== 'all') {
        query = options.targetIndex
          ? query.eq('matches_target_region', true)
          : query.or(targetRegionPostgrestClauses().join(','));
      }

      // Country / continent facets (D4/D5). They live on jobs_v3 (0161), not on
      // public.jobs, so every read path — archive included since 0163 — has to
      // target the read table for these filters to bind.
      if (options.countryIndex) {
        if (countries.length > 0) query = query.in('country_code', countries);
        if (continents.length > 0) query = query.in('continent', continents);
      }

      if (directions.length > 0) query = query.in('direction', expandMappedValues(directions, directionMapping));

      const queryOffset = entryLevelFilter ? 0 : offset;
      return query.range(queryOffset, rangeEnd);
    };

    const options: ListingQueryOptions = {
      listingView: Date.now() >= listingViewRetryAt,
      regionIndex: Date.now() >= regionListingRetryAt,
      targetIndex: Date.now() >= targetRegionRetryAt,
      countryIndex: Date.now() >= countryIndexRetryAt,
    };
    let result = await buildQuery(options);

    // Downgrade one structure at a time when the matching migration has not
    // landed yet, instead of failing the whole request. A schema-cache miss is
    // retried against the same structure once, because PostgREST only needs a
    // moment to reload after a migration's `notify pgrst`.
    let schemaCacheRetried = false;
    for (let attempt = 0; attempt < 4 && result.error; attempt += 1) {
      const missing = detectMissingStructure(result.error);
      if (!missing) break;
      const isSchemaCache = result.error.code === 'PGRST204' || result.error.code === 'PGRST205';
      if (isSchemaCache && !schemaCacheRetried) {
        schemaCacheRetried = true;
        result = await buildQuery(options);
        continue;
      }
      const retryAt = Date.now() + (isSchemaCache ? SCHEMA_CACHE_RETRY_MS : STRUCTURE_RETRY_MS);
      if (missing === 'view' && options.listingView) {
        listingViewRetryAt = retryAt;
        options.listingView = false;
      } else if (missing === 'region' && options.regionIndex) {
        regionListingRetryAt = retryAt;
        options.regionIndex = false;
      } else if (missing === 'target' && options.targetIndex) {
        targetRegionRetryAt = retryAt;
        options.targetIndex = false;
      } else if (missing === 'country' && options.countryIndex) {
        countryIndexRetryAt = retryAt;
        options.countryIndex = false;
      } else {
        break;
      }
      result = await buildQuery(options);
    }

    if (!result.error) {
      if (options.listingView) listingViewRetryAt = 0;
      if (options.regionIndex && regionListingFilter) regionListingRetryAt = 0;
      if (options.targetIndex && targetScopeRequested) targetRegionRetryAt = 0;
      if (options.countryIndex && explicitGeo) countryIndexRetryAt = 0;
    }

    const { data, error, count } = result;

    if (error) {
      console.error('Jobs listing query failed', {
        code: error.code,
        message: error.message,
        filters: { regions, directions, jobType, sponsorship, status, countries, continents, hasSearch: Boolean(search), offset },
        indexes: {
          listingView: options.listingView,
          regionIndex: options.regionIndex,
          targetIndex: options.targetIndex,
          countryIndex: options.countryIndex,
        },
      });
      if (error.message.includes('Requested range not satisfiable')) {
        return NextResponse.json({
          jobs: [],
          pagination: { offset, limit: pageLimit, returned: 0, total: 0, total_is_estimate: true, has_more: false },
        });
      }
      if (isStatementTimeout(error)) {
        // Surface a retryable condition instead of a generic 500 so the client
        // can offer "try again" rather than an empty result list.
        return NextResponse.json(
          { error: '岗位查询超时，请稍后重试', retryable: true },
          { status: 503, headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
        );
      }
      throw new Error(`查询岗位失败: ${error.message}`);
    }

    const jobRows = (data ?? []) as unknown as Array<{
      region: string;
      direction: string;
      company: string;
      [key: string]: unknown;
    }>;
    const filteredCandidates = entryLevelFilter
      ? jobRows.filter(isEntryLevelJobCompatible)
      : jobRows;
    const hasMore = entryLevelFilter
      ? filteredCandidates.length > offset + pageLimit || jobRows.length > rangeEnd
      : jobRows.length > pageLimit;
    const filteredJobs = entryLevelFilter
      ? filteredCandidates.slice(offset, offset + pageLimit)
      : filteredCandidates.slice(0, pageLimit);

    // A short page proves the exact total without a COUNT(*) over the whole
    // index. Otherwise an indexable query already carries the exact count from
    // PostgREST; only the scan-prone queries keep the planner estimate.
    const shortPageTotal = !entryLevelFilter && jobRows.length <= pageLimit
      ? offset + jobRows.length
      : null;
    const exactTotal = shortPageTotal ?? (exactCountSafe && typeof count === 'number' ? count : null);

    // 为每个岗位添加分类信息和 logo
    const companies = [...new Set(filteredJobs.map((job) => String((job as { company?: unknown }).company || '')).filter(Boolean))];
    const missingCompanies = companies.filter((company) => !localLogosCache[company]);
    if (missingCompanies.length > 0) {
      const { data: logoRows } = await client
        .from('company_logos')
        .select('company_name, logo_url')
        .in('company_name', missingCompanies);
      for (const row of logoRows || []) {
        if (row.logo_url) localLogosCache[row.company_name] = row.logo_url;
      }
    }
    const jobsWithLogo = filteredJobs.map((job) => {
      const sanitizedJob = sanitizeJobContent(job);
      if (!isDisplayableJobDescription(sanitizedJob.description)) sanitizedJob.description = null;
      // Historical collection rows did not record provenance. Keep them
      // searchable for continuity, but do not present their salary, deadline
      // or location as candidate-facing facts until a verified source arrives.
      const visibleSalary = isVerifiedField(sanitizedJob.salary_range, typeof sanitizedJob.salary_source === 'string' ? sanitizedJob.salary_source : null);
      const deadlineSourceType: string | null = sanitizedJob.field_evidence && typeof sanitizedJob.field_evidence === 'object' && !Array.isArray(sanitizedJob.field_evidence)
        && typeof (sanitizedJob.field_evidence as Record<string, unknown>).source_type === 'string'
        ? (sanitizedJob.field_evidence as Record<string, unknown>).source_type as string
        : null;
      const visibleDeadline = isVerifiedField(sanitizedJob.valid_through, typeof sanitizedJob.deadline_source === 'string' ? sanitizedJob.deadline_source : null)
        && isDisplayableJobDeadline(sanitizedJob.valid_through, typeof sanitizedJob.deadline_source === 'string' ? sanitizedJob.deadline_source : null, deadlineSourceType);
      const visibleLocation = isVerifiedField(sanitizedJob.region, typeof sanitizedJob.location_source === 'string' ? sanitizedJob.location_source : null);
      return {
        ...sanitizedJob,
        salary_range: visibleSalary ? sanitizedJob.salary_range : null,
        valid_through: visibleDeadline ? sanitizedJob.valid_through : null,
        region: visibleLocation ? sanitizedJob.region : '未注明',
        ...(summaryOnly ? { description: compactListDescription(sanitizedJob.description) } : {}),
        region_category: visibleLocation ? getRegionCategory(job.region) : '未注明',
        direction_category: getDirectionCategory(job.direction),
        ...resolveDisplayLogoUrls(
          job.company,
          typeof job.job_url === 'string' ? job.job_url : null,
          localLogosCache[job.company] || null,
        ),
      };
    });

    return NextResponse.json({
      jobs: jobsWithLogo,
      pagination: {
        offset,
        limit: pageLimit,
        returned: jobsWithLogo.length,
        total: exactTotal ?? count ?? 0,
        total_is_estimate: exactTotal === null,
        // The planner has no statistics for the derived market column, so its
        // estimate for a market filter is unreliable (it falls back to the
        // default 0.5% selectivity). Tell the client to show only the page
        // number instead of a misleading count.
        total_is_unknown: exactTotal === null && regionListingFilter !== null,
        has_more: hasMore,
      },
    }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    });
  } catch (error) {
    console.error('Error fetching jobs:', error);
    return NextResponse.json(
      { error: '获取岗位列表失败' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const permissionError = await requireAdminPermission(request, ADMIN_PERMISSIONS.jobsWrite);
    if (permissionError) return permissionError;
    const client = getSupabaseClient();
    const body = await request.json();

    const requiredFields = ['title', 'company', 'region', 'direction', 'audience'] as const;
    if (requiredFields.some((field) => typeof body[field] !== 'string' || !body[field].trim())) {
      return NextResponse.json({ error: '岗位名称、公司、地区、方向、受众均为必填项' }, { status: 400 });
    }

    const { data: duplicate } = await client
      .from('jobs')
      .select('id, title, company')
      .ilike('title', body.title.trim())
      .ilike('company', body.company.trim())
      .limit(1)
      .maybeSingle();
    if (duplicate) {
      return NextResponse.json({ error: '岗位已存在', duplicate }, { status: 409 });
    }

    // 自动检测 sponsorship
    const description = body.description || '';
    const requirements = body.requirements || '';
    const fullText = description + ' ' + requirements;
    const sponsorship = detectSponsorship(fullText);

    const normalizedBody = Object.fromEntries(
      Object.entries(body).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]),
    );
    const { data, error } = await client
      .from(jobWriteTable())
      .insert({ ...normalizedBody, sponsorship })
      .select()
      .single();

    if (error) {
      throw new Error(`创建岗位失败: ${error.message}`);
    }

    await recordAdminAuditEvent({
      request,
      action: 'job.create',
      resourceType: 'job',
      resourceId: data.id,
      afterData: data,
    });

    return NextResponse.json({ job: data });
  } catch (error) {
    console.error('Error creating job:', error);
    await recordAdminAuditFailure({ request, action: 'job.create', resourceType: 'job', error });
    return NextResponse.json(
      { error: '创建岗位失败' },
      { status: 500 }
    );
  }
}
