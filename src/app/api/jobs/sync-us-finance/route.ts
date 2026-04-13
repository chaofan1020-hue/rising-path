import { NextRequest, NextResponse } from 'next/server';
import { SearchClient, FetchClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 美国顶尖金融公司
const FINANCE_COMPANIES = [
  'Goldman Sachs', 'Morgan Stanley', 'JPMorgan', 'BlackRock', 'Bloomberg',
  'Citadel', 'Two Sigma', 'Jane Street', 'Barclays', 'Deutsche Bank',
  'Wells Fargo', 'Bank of America', 'Citi', 'Credit Suisse', 'UBS', 'HSBC',
  'Vanguard', 'Fidelity', 'PIMCO', 'DE Shaw', 'AQR Capital', 'Two Sigma'
];

// 金融岗位相关关键词
const FINANCE_KEYWORDS = [
  'analyst', 'associate', 'trader', 'quant', 'quantitative', 'developer',
  'engineer', 'swe', 'software', 'technology', 'data scientist',
  'investment banking', 'ibd', 'sales and trading', 's&t', 'risk',
  'portfolio', 'research', 'modeling', 'fintech'
];

// 只保留美国主要地区
const US_REGIONS = [
  'New York, NY', 'San Francisco, CA', 'Boston, MA', 'Chicago, IL',
  'Los Angeles, CA', 'Seattle, WA', 'Austin, TX', 'Dallas, TX',
  'Charlotte, NC', 'Jersey City, NJ', 'Hoboken, NJ', 'Greenwich, CT',
  'Remote - United States', 'United States'
];

// 验证岗位标题
function isValidTitle(title: string): boolean {
  if (!title || title.length < 10) return false;
  
  const titleLower = title.toLowerCase();
  
  // 过滤中文
  if (/[\u4e00-\u9fa5]/.test(title)) return false;
  
  // 过滤非英语语言特征
  if (/rekrytointi|rekrytering|reclutamiento|rekrutacja|recrute|stellenanzeige|empleo|offre d'emploi|trabajo|pracownik|mitarbeiter/i.test(title)) return false;
  
  // 过滤数字开头的标题
  if (/^\d+[\s,]/.test(title)) return false;
  
  // 检查是否包含金融相关关键词
  const hasKeyword = FINANCE_KEYWORDS.some(kw => titleLower.includes(kw));
  if (!hasKeyword) return false;
  
  // 过滤太通用的标题
  const genericTitles = [
    'analyst', 'associate', 'trader', 'manager', 'director', 'vp',
    'intern', 'summer analyst', 'summer associate'
  ];
  if (genericTitles.includes(titleLower.trim())) return false;
  
  // 过滤非技术类岗位
  if (/recruiter|hr|human resources|marketing manager|account executive|account manager|sales representative|customer success/i.test(title)) return false;
  
  // 过滤个人帖子和列表页
  if (/'s post|post$|hiring|work with us|find new jobs|careers in|about us|our team/i.test(title)) return false;
  
  // 过滤包含 @ 符号（通常是个人账号）
  if (/@\w+/.test(title)) return false;
  
  return true;
}

// 智能分类岗位方向
function classifyDirection(title: string): string {
  const titleLower = title.toLowerCase();
  
  // Quant / Trading
  if (/\b(quant|quantitative|trader|trading)\b/.test(titleLower)) return 'Quant';
  
  // IBD / S&T
  if (/\b(ibd|investment banking|s&t|sales and trading|mergers|acquisitions|m&a)\b/.test(titleLower)) return 'IBD/S&T';
  
  // Risk
  if (/\b(risk|fraud|compliance|regulatory)\b/.test(titleLower)) return 'Risk';
  
  // Data
  if (/\b(data scientist|data engineer|data analyst|analytics|analytics)\b/.test(titleLower)) return 'Data';
  
  // SDE
  if (/\b(swe|software engineer|software developer|developer|backend|frontend|fullstack|full-stack|full stack|engineer|technology|tech)\b/.test(titleLower)) return 'SDE';
  
  // ML/AI
  if (/\b(mle|machine learning|deep learning|ai|ml|artificial intelligence)\b/.test(titleLower)) return 'ML/AI';
  
  // PM
  if (/\b(product manager|program manager|pm|product owner)\b/.test(titleLower)) return 'PM';
  
  // Finance
  return 'Finance';
}

// 验证 URL - 只接受真正的岗位页面
function isValidUrl(url: string): boolean {
  const urlLower = url.toLowerCase();
  
  // 过滤噪音网站
  const blockedPatterns = [
    'zhihu', 'baidu', 'qq.com', '163.com', 'sina', 'sohu.com', 
    'liepin.com', '51job.com', 'zhaopin', 'zhipin.com', 'zhipin',
    'dubclub', 'zensar', 'chels', 'lazer', 'honeysuckle', 'gelato',
    'getro.com', 'goodwillness.com', 'contactout.com',
    'arc.dev', 'builtin.com', 'handwiki.org', '6figr.com', 'ycombinator.com',
    'wiki', 'blog', 'article', '/news/', 'pulse', 'fortune', 'medium.com', 
    'youtube.com', 'casestudy', 'comparisons', 'glassdoor', 'indeed',
    // 过滤非岗位页面
    '/what-we-do/', '/about-us/', '/about-us', '/products/', '/funds/',
    'am.jpmorgan.com',  // 基金页面
    '/research/', '/insights/', '/stories/'
  ];
  
  for (const pattern of blockedPatterns) {
    if (urlLower.includes(pattern)) return false;
  }
  
  // LinkedIn 只接受具体岗位详情页（包含 /view/ 且是职位页面）
  if (urlLower.includes('linkedin.com/jobs/')) {
    // 必须是具体岗位详情页格式
    if (!urlLower.includes('/jobs/view/')) return false;
    // 过滤 LinkedIn 搜索结果页
    if (urlLower.includes('/jobs/search?') || urlLower.includes('/jobs/?')) return false;
  }
  
  // 允许的域名
  const allowedDomains = [
    // 金融公司官网 careers
    'goldmansachs.com/careers', 'goldmansachs.com/jobs',
    'morganstanley.com/careers', 'morganstanley.jobs',
    'jpmorgan.com/careers', 'jpmorganchase.com/careers', 'careers.jpmorgan.com',
    'blackrock.com/careers', 'blackrock.jobs',
    'bloomberg.com/careers', 'careers.bloomberg.com',
    'citadel.com/careers', 'careers.citadel.com',
    'twosigma.com/careers', 'careers.twosigma.com',
    'janestreet.com/careers', 'careers.janestreet.com',
    'barclays.com/careers', 'barclays.jobs',
    'deutschebank.com/careers',
    'wellsfargo.com/careers',
    'bankofamerica.com/careers',
    'citi.com/careers', 'citigroup.com/careers',
    'vanguard.com/careers',
    'fidelity.com/careers',
    'pimco.com/careers',
    'deshaw.com/careers',
    'aqr.com/careers',
    // 招聘平台
    'greenhouse.io', 'lever.co', 'workday.com', 'successfactors.com',
    'linkedin.com/jobs/view/',
    // 允许的金融公司其他域名
    '.goldmansachs.com', '.morganstanley.com', '.jpmorgan.com', 
    '.blackrock.com', '.citadel.com'
  ];
  
  return allowedDomains.some(domain => urlLower.includes(domain));
}

// 过滤非美国地区
function isUsJob(url: string): boolean {
  const urlLower = url.toLowerCase();
  const countryPatterns = ['/tw/', '/cn/', '/hk/', '/sg/', '/uk/', '/de/', '/fr/', '/au/', '/in/', '/jp/', '/kr/', '/br/', '/mx/'];
  
  // 提取路径
  const pathMatch = url.match(/\.com(\/[^\?#]*)/i);
  const path = pathMatch ? pathMatch[1] : '';
  
  for (const pattern of countryPatterns) {
    if (path.includes(pattern)) return false;
  }
  
  // 检查是否是 country.linkedin.com 格式
  if (/^https?:\/\/[a-z]{2}\.linkedin\.com/i.test(url)) return false;
  
  return true;
}

// 提取岗位标题
function extractTitle(rawTitle: string, defaultCompany: string): string {
  let title = rawTitle
    .replace(new RegExp(`^(${FINANCE_COMPANIES.join('|')})\\s+(?:careers?|jobs?\\s+)?`, 'i'), '')
    .replace(/\s*[-|]\s*(Careers?|Jobs?|LinkedIn|Glassdoor|Indeed).*$/i, '')
    .replace(/\s+at\s+(${FINANCE_COMPANIES.join('|')})\s*$/i, '')
    .replace(/['"']s (post|Post|Join Our Team)$/i, '')
    .replace(/^(Job Alert: |New: |View Job: )/i, '')
    .replace(/\s*\(Open to remote\)/i, '')
    .trim();
  
  return title.substring(0, 150);
}

// 提取地区
function extractRegion(url: string, title: string): string {
  const titleLower = title.toLowerCase();
  const urlLower = url.toLowerCase();
  
  // 从标题中提取
  for (const region of US_REGIONS) {
    if (titleLower.includes(region.toLowerCase()) || urlLower.includes(region.toLowerCase().replace(/, /g, '-'))) {
      return region;
    }
  }
  
  // 从 URL 中提取
  const locationPatterns = [
    { pattern: /new-york|nyc|ny-|newyork/i, region: 'New York, NY' },
    { pattern: /san-francisco|sf\b|sanfrancisco/i, region: 'San Francisco, CA' },
    { pattern: /boston|boston/i, region: 'Boston, MA' },
    { pattern: /chicago/i, region: 'Chicago, IL' },
    { pattern: /los-angeles|la\b|losangeles/i, region: 'Los Angeles, CA' },
    { pattern: /seattle/i, region: 'Seattle, WA' },
    { pattern: /austin/i, region: 'Austin, TX' },
    { pattern: /dallas/i, region: 'Dallas, TX' },
    { pattern: /charlotte/i, region: 'Charlotte, NC' },
    { pattern: /jersey-city|jerseycity/i, region: 'Jersey City, NJ' },
    { pattern: /hoboken/i, region: 'Hoboken, NJ' },
    { pattern: /greenwich/i, region: 'Greenwich, CT' },
    { pattern: /remote/i, region: 'Remote - United States' },
  ];
  
  for (const { pattern, region } of locationPatterns) {
    if (pattern.test(title) || pattern.test(url)) {
      return region;
    }
  }
  
  return 'New York, NY'; // 默认纽约
}

// 获取真实岗位描述
async function fetchJobDescription(url: string, company: string, snippet?: string): Promise<string> {
  const urlLower = url.toLowerCase();
  
  // LinkedIn 岗位详情页 - 使用搜索片段或标题作为描述
  if (urlLower.includes('linkedin.com/jobs/view/')) {
    // 如果有搜索片段，使用它作为描述
    if (snippet && snippet.length > 50) {
      return snippet
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .substring(0, 3000);
    }
    
    // 否则只返回标题
    return '';
  }
  
  // 官网和招聘平台 - 尝试获取详细描述
  const isOfficial = 
    urlLower.includes('greenhouse.io') ||
    urlLower.includes('lever.co') ||
    urlLower.includes('workday.com') ||
    urlLower.includes('successfactors.com') ||
    urlLower.includes('/careers/') ||
    urlLower.includes('/jobs/');
  
  if (!isOfficial) {
    // 如果不是官网，使用搜索片段
    if (snippet && snippet.length > 50) {
      return snippet
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .substring(0, 3000);
    }
    return '';
  }
  
  try {
    const config = new Config();
    const customHeaders = HeaderUtils.extractForwardHeaders({} as NextRequest.headers);
    const client = new FetchClient(config, customHeaders);
    const response = await client.fetch(url);
    
    if (response.status_code === 0 && response.content) {
      const textContent = response.content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n')
        .substring(0, 3000);
      
      if (textContent.length > 100) {
        return textContent
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }
    }
  } catch (error) {
    console.error('Fetch error:', error);
  }
  
  // 兜底使用搜索片段
  if (snippet && snippet.length > 50) {
    return snippet
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .substring(0, 3000);
  }
  
  return '';
}

export async function POST(request: NextRequest) {
  try {
    // 验证管理员密码
    const authHeader = request.headers.get('x-admin-password');
    if (!authHeader) {
      return NextResponse.json({ error: '需要管理员密码' }, { status: 401 });
    }
    
    // 导入密码验证逻辑
    const { verifyAdminPassword } = await import('@/lib/admin-auth');
    const isValid = await verifyAdminPassword(authHeader);
    if (!isValid) {
      return NextResponse.json({ error: '管理员密码错误' }, { status: 401 });
    }

    const config = new Config();
    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const client = new SearchClient(config, customHeaders);
    const supabase = getSupabaseClient();

    const results = {
      success: 0,
      skipped: 0,
      failed: 0,
      invalid: 0,
      total: 0,
      descriptions: 0,
      details: [] as string[],
    };

    const seenUrls = new Set<string>();
    const jobsToInsert: Array<{ title: string; company: string; region: string; url: string; description: string; direction: string }> = [];

    for (const company of FINANCE_COMPANIES) {
      const queries = [
        `${company} software engineer jobs New York`,
        `${company} quantitative developer jobs`,
        `${company} technology analyst positions`,
        `${company} engineering jobs openings 2024`,
      ];

      for (const query of queries.slice(0, 3)) {
        try {
          const response = await client.webSearch(query, 10, false);

          if (response.web_items && response.web_items.length > 0) {
            for (const item of response.web_items) {
              const url = item.url || '';
              
              if (seenUrls.has(url)) continue;
              seenUrls.add(url);
              
              const title = extractTitle(item.title || '', company);
              const direction = classifyDirection(title);
              const snippet = item.snippet || '';
              
              // 额外验证：LinkedIn 岗位标题必须包含公司名
              if (urlLower.includes('linkedin.com') && !item.title?.toLowerCase().includes(company.toLowerCase())) {
                results.skipped++;
                continue;
              }
              
              results.total++;
              
              // 验证
              if (!isValidUrl(url)) {
                results.skipped++;
                continue;
              }
              
              if (!isUsJob(url)) {
                results.skipped++;
                continue;
              }
              
              if (!isValidTitle(title)) {
                results.invalid++;
                results.details.push(`[无效] ${title.substring(0, 50)}`);
                continue;
              }
              
              const region = extractRegion(url, title);
              
              // 检查是否已存在
              const { data: existing } = await supabase
                .from('jobs')
                .select('id')
                .eq('job_url', url)
                .single();
              
              if (existing) {
                results.skipped++;
                continue;
              }
              
              // 获取详细描述（传入搜索片段）
              const snippet = item.snippet || '';
              const description = await fetchJobDescription(url, company, snippet);
              if (description) {
                results.descriptions++;
              }
              
              jobsToInsert.push({
                title,
                company,
                region,
                url,
                description: description || title,
                direction,
              });
              
              results.details.push(`[新增] ${title.substring(0, 60)}...`);
            }
          }
        } catch (error) {
          console.error(`Search error for ${company}:`, error);
          results.failed++;
        }
        
        // 避免请求过快
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // 批量插入
    if (jobsToInsert.length > 0) {
      const jobs = jobsToInsert.map(job => ({
        title: job.title,
        company: job.company,
        region: job.region,
        direction: job.direction,
        job_url: job.url,
        description: job.description,
        requirements: '',
        salary_range: '',
        audience: '留学生',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      const { error: insertError } = await supabase
        .from('jobs')
        .insert(jobs)
        .select('id');

      if (insertError) {
        console.error('Insert error:', insertError);
        results.failed += jobsToInsert.length;
      } else {
        results.success = jobsToInsert.length;
      }
    }

    return NextResponse.json({
      message: '金融岗位同步完成',
      ...results,
    });
  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json(
      { error: '同步失败', details: String(error) },
      { status: 500 }
    );
  }
}
