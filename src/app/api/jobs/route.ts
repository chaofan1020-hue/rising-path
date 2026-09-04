import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { detectSponsorship } from '@/lib/utils';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { isDisplayableJobDescription, sanitizeJobContent } from '@/lib/job-content';
import { TARGET_REGION_KEYWORDS, targetRegionPostgrestClauses } from '@/lib/job-region-scope';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';
import { getCompanyFaviconUrl, getCompanyLogoUrl } from '@/lib/company-logo';
import { isVerifiedField } from '@/lib/job-field-provenance';
import { isDisplayableJobDeadline } from '@/lib/job-deadline';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Keep only logos seen on the current result pages in memory. Loading the
// entire company_logos table before every cold jobs request added an extra
// round trip without improving the response for most pages.
const localLogosCache: Record<string, string> = {};

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

export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    
    // 获取多选参数（地区和方向支持多选）
    const regions = searchParams.getAll('region');
    const directions = searchParams.getAll('direction');
    const audience = searchParams.get('audience');
    const jobType = searchParams.get('job_type');
    const sponsorship = searchParams.get('sponsorship');
    const status = searchParams.get('status') || 'active';
    const regionScope = searchParams.get('region_scope') || 'target';
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

    // Supabase's generated select parser requires a literal column string;
    // the route intentionally chooses one of two fixed projections here.
    let query = summaryOnly
      ? client.from('jobs').select('id,title,company,region,direction,audience,job_type,employment_category,experience_min_years,experience_max_years,experience_text,description,salary_range,employment_type,workplace_type,job_url,sponsorship,valid_through,deadline_time_zone,deadline_source,salary_source,location_source,field_evidence,is_active,is_closed,created_at,updated_at', { count: 'planned' })
      : client.from('jobs').select('id,title,company,region,direction,audience,job_type,employment_category,experience_min_years,experience_max_years,experience_text,description,requirements,salary_range,employment_type,workplace_type,job_url,sponsorship,valid_through,deadline_time_zone,deadline_source,salary_source,location_source,field_evidence,is_active,is_closed,created_at,updated_at', { count: 'planned' });

    if (diverseFeed) {
      // updated_at reflects the active feed refresh and naturally mixes the
      // latest jobs from different companies better than import-time created_at.
      query = query
        .order('updated_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
    } else {
      // Jobs imported in one feed batch share a timestamp. A stable secondary
      // key prevents pagination from duplicating or skipping those records.
      query = query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
    }

    // 默认只显示可投递岗位；管理员或筛选器可以显式请求全部/已关闭岗位。
    if (status === 'closed') query = query.eq('is_active', false);
    else if (status !== 'all') query = query.eq('is_active', true);

    // A selected market already scopes the query to that market. Applying a
    // second `.or()` here would create duplicate PostgREST `or` parameters
    // and can silently replace the user's region filter, so only add the
    // default target scope when no explicit region was selected.

    // 受众单选筛选
    if (audience && audience !== '全部') {
      query = query.eq('audience', audience);
    }

    // 岗位类型筛选（实习/校招/社招）
    if (jobType && jobType !== '全部') {
      query = query.eq('job_type', jobType);
    }

    if (sponsorship && sponsorship !== '全部') {
      query = query.eq('sponsorship', sponsorship);
    }

    if (exactCompanies.length > 0) {
      query = query.in('company', exactCompanies);
    }

    const company = searchParams.get('company')?.trim() || '';
    if (company) {
      query = query.ilike('company', `%${escapePostgrestSearchTerm(company)}%`);
    }

    if (search) {
      const safeSearch = escapePostgrestSearchTerm(search);
      query = query.or(`title.ilike.%${safeSearch}%,company.ilike.%${safeSearch}%`);
    }

    if (regions.length > 0) {
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
    } else if (regionScope !== 'all') {
      query = query.or(targetRegionPostgrestClauses().join(','));
    }

    if (directions.length > 0) {
      query = query.in('direction', expandMappedValues(directions, directionMapping));
    }

    // 不允许把完整岗位库一次传回浏览器。全量同步后岗位数据可达数万条，
    // 因此前端按页请求，默认 100 条。
    // Fetch one extra row so pagination remains correct even though the total
    // count uses the planner estimate instead of a full-table exact count.
    // Fetch a little extra for entry-level filters. Legacy rows may carry an
    // incorrect category, so filtering after retrieval must not leave a page
    // empty when a handful of rows are rejected.
    const entryLevelFilter = jobType === '实习' || jobType === '校招';
    const queryOffset = entryLevelFilter ? 0 : offset;
    const rangeEnd = entryLevelFilter
      ? offset + (pageLimit * 3)
      : offset + pageLimit;
    query = query.range(queryOffset, rangeEnd);

    const { data, error, count } = await query;

    if (error) {
      if (error.message.includes('Requested range not satisfiable')) {
        return NextResponse.json({
          jobs: [],
          pagination: { offset, limit: pageLimit, returned: 0, total: 0, has_more: false },
        });
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
        logo_url: localLogosCache[job.company]
          || getCompanyLogoUrl(job.company, typeof job.job_url === 'string' ? job.job_url : null),
        logo_fallback_url: getCompanyFaviconUrl(job.company, typeof job.job_url === 'string' ? job.job_url : null),
      };
    });

    return NextResponse.json({
      jobs: jobsWithLogo,
      pagination: {
        offset,
        limit: pageLimit,
        returned: jobsWithLogo.length,
        total: count ?? 0,
        total_is_estimate: true,
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
    const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.jobsWrite);
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
      .from('jobs')
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
