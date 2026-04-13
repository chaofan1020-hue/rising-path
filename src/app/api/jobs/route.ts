import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

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

// 获取公司 logo URL（优先本地，fallback 到 Clearbit）
async function getCompanyLogo(company: string): Promise<string | null> {
  // 先检查缓存
  if (localLogosCache[company]) {
    return localLogosCache[company];
  }
  
  // 尝试从数据库获取本地 logo
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('company_logos')
      .select('logo_url')
      .eq('company_name', company)
      .single();
    
    if (data?.logo_url) {
      localLogosCache[company] = data.logo_url;
      return data.logo_url;
    }
  } catch (error) {
    // 忽略错误，继续使用 Clearbit
  }
  
  // 使用 Clearbit API
  const domain = companyDomains[company];
  if (domain) {
    return `https://logo.clearbit.com/${domain}`;
  }
  const cleanName = company.toLowerCase().replace(/\s+/g, '');
  return `https://logo.clearbit.com/${cleanName}.com`;
}

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
  // 新加坡
  'Singapore': '新加坡',
  // 香港
  'Hong Kong': '香港',
  // 日本
  'Tokyo, Japan': '日本',
  'Japan': '日本',
  // 欧洲
  'Germany': '德国',
  'France': '法国',
  'Europe': '欧洲',
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

// 判断岗位是否匹配选中的地区（支持包含关系）
function isRegionMatch(jobRegion: string, selectedRegions: string[]): boolean {
  if (selectedRegions.length === 0) return true;
  
  for (const selected of selectedRegions) {
    const jobCategory = getRegionCategory(jobRegion);
    if (jobCategory === selected) return true;
    if (jobRegion === selected) return true;
  }
  return false;
}

// 判断岗位是否匹配选中的方向（支持包含关系）
function isDirectionMatch(jobDirection: string, selectedDirections: string[]): boolean {
  if (selectedDirections.length === 0) return true;
  
  for (const selected of selectedDirections) {
    // 如果选中的方向等于岗位的方向
    if (jobDirection === selected) return true;
    // 如果岗位方向属于选中方向的大类（SDE 包含 Fullstack/Backend/Frontend/Mobile）
    const jobCategory = getDirectionCategory(jobDirection);
    if (jobCategory === selected) return true;
  }
  return false;
}

export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    
    // 获取多选参数（地区和方向支持多选）
    const regions = searchParams.getAll('region');
    const directions = searchParams.getAll('direction');
    const audience = searchParams.get('audience');
    const limit = searchParams.get('limit');

    let query = client
      .from('jobs')
      .select('*')
      .order('created_at', { ascending: false });

    // 只获取活跃的岗位
    query = query.eq('is_active', true);

    // 受众单选筛选
    if (audience && audience !== '全部') {
      query = query.eq('audience', audience);
    }

    // 限制返回数量（用于自动同步检查）
    if (limit) {
      query = query.limit(parseInt(limit));
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`查询岗位失败: ${error.message}`);
    }

    // 筛选结果
    let filteredJobs = data || [];

    // 地区筛选（支持包含关系）
    if (regions.length > 0) {
      filteredJobs = filteredJobs.filter((job: { region: string }) => isRegionMatch(job.region, regions));
    }

    // 方向筛选（支持包含关系：选 Tech 包含所有方向）
    if (directions.length > 0) {
      filteredJobs = filteredJobs.filter((job: { direction: string }) => isDirectionMatch(job.direction, directions));
    }

    // 检查是否需要刷新缓存
    if (Date.now() - lastCacheTime > CACHE_DURATION) {
      await refreshLogoCache();
    }

    // 为每个岗位添加分类信息和 logo
    const jobsWithLogo = await Promise.all(
      filteredJobs.map(async (job: { region: string; direction: string; company: string; [key: string]: unknown }) => ({
        ...job,
        region_category: getRegionCategory(job.region),
        direction_category: getDirectionCategory(job.direction),
        logo_url: await getCompanyLogo(job.company)
      }))
    );

    return NextResponse.json({ jobs: jobsWithLogo });
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
    const client = getSupabaseClient();
    const body = await request.json();

    const { data, error } = await client
      .from('jobs')
      .insert(body)
      .select()
      .single();

    if (error) {
      throw new Error(`创建岗位失败: ${error.message}`);
    }

    return NextResponse.json({ job: data });
  } catch (error) {
    console.error('Error creating job:', error);
    return NextResponse.json(
      { error: '创建岗位失败' },
      { status: 500 }
    );
  }
}
