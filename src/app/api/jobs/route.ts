import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { detectSponsorship } from '@/lib/utils';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { sanitizeJobContent } from '@/lib/job-content';
import { targetRegionPostgrestClauses } from '@/lib/job-region-scope';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';

// 公司域名映射
const companyDomains: Record<string, string> = {
  'Stripe': 'stripe.com',
  'Airbnb': 'airbnb.com',
  'Uber': 'uber.com',
  'Lyft': 'lyft.com',
  'DoorDash': 'doordash.com',
  'Dropbox': 'dropbox.com',
  'Coinbase': 'coinbase.com',
  'Robinhood': 'robinhood.com',
  'Figma': 'figma.com',
  'Notion': 'notion.so',
  'Palantir': 'palantir.com',
  'Databricks': 'databricks.com',
  'Snowflake': 'snowflake.com',
  'Twilio': 'twilio.com',
  'Zoom': 'zoom.us',
  'Atlassian': 'atlassian.com',
  'Confluent': 'confluent.io',
  'MongoDB': 'mongodb.com',
  'Cloudflare': 'cloudflare.com',
  'Rubrik': 'rubrik.com',
  'Scale AI': 'scale.com',
  'OpenAI': 'openai.com',
  'Anthropic': 'anthropic.com',
  'Instacart': 'instacart.com',
  'Discord': 'discord.com',
  'Plaid': 'plaid.com',
  'Brex': 'brex.com',
  'Datadog': 'datadoghq.com',
  'GitLab': 'gitlab.com',
  'Google': 'google.com',
  'Meta': 'meta.com',
  'Apple': 'apple.com',
  'Microsoft': 'microsoft.com',
  'Amazon': 'amazon.com',
  'Netflix': 'netflix.com',
  'Tesla': 'tesla.com',
  'NVIDIA': 'nvidia.com',
  'Adobe': 'adobe.com',
  'Oracle': 'oracle.com',
  'Salesforce': 'salesforce.com',
  'Snap': 'snap.com',
  'Pinterest': 'pinterest.com',
  'LinkedIn': 'linkedin.com',
};

// 本地 logo 缓存
let localLogosCache: Record<string, string> = {};
let lastCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 分钟

// 刷新 logo 缓存
async function refreshLogoCache(): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase.from('company_logos').select('company_name, logo_url');
    
    if (data) {
      localLogosCache = {};
      for (const item of data) {
        localLogosCache[item.company_name] = item.logo_url;
      }
      lastCacheTime = Date.now();
    }
  } catch (error) {
    console.error('Error refreshing logo cache:', error);
  }
}

// 地区映射：将具体地区映射到所属大地区
const regionMapping: Record<string, string> = {
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
};

const regionKeywords: Record<string, string[]> = {
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

function getLogoFallback(company: string): string | null {
  const domain = companyDomains[company];
  if (domain) return `https://logo.clearbit.com/${domain}`;
  const cleanName = company.toLowerCase().replace(/\s+/g, '');
  return cleanName ? `https://logo.clearbit.com/${cleanName}.com` : null;
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
    const limit = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');
    const requestedLimit = Number.parseInt(limit || '100', 10);
    const pageLimit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 200) : 100;
    const requestedOffset = Number.parseInt(offsetParam || '0', 10);
    const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0;

    let query = client
      .from('jobs')
      .select('id,title,company,region,direction,audience,job_type,description,requirements,salary_range,job_url,sponsorship,is_active,is_closed,created_at,updated_at', { count: 'exact' })
      .order('created_at', { ascending: false });

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
    query = query.range(offset, offset + pageLimit - 1);

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

    const filteredJobs = data || [];

    // 检查是否需要刷新缓存
    if (Date.now() - lastCacheTime > CACHE_DURATION) {
      await refreshLogoCache();
    }

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
    const jobsWithLogo = filteredJobs.map((job: { region: string; direction: string; company: string; [key: string]: unknown }) => ({
      ...sanitizeJobContent(job),
      region_category: getRegionCategory(job.region),
      direction_category: getDirectionCategory(job.direction),
      logo_url: localLogosCache[job.company] || getLogoFallback(job.company),
    }));

    return NextResponse.json({
      jobs: jobsWithLogo,
      pagination: {
        offset,
        limit: pageLimit,
        returned: jobsWithLogo.length,
        total: count ?? 0,
        has_more: offset + jobsWithLogo.length < (count ?? 0),
      },
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
