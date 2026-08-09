import { NextRequest, NextResponse } from 'next/server';
import { SearchClient, FetchClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { hasValidAdminSession } from '@/lib/admin-auth';

// 解析岗位描述为结构化数据
function parseJobDescription(text: string, title: string, company: string): {
  overview: string;
  responsibilities: string;
  requirements: string;
  nice_to_have: string;
} {
  // 生成概述
  const overview = `Join ${company}'s team as ${title}. This role offers an opportunity to work on cutting-edge projects in a fast-paced environment.`;
  
  // 提取职责
  const respPatterns = [
    /what you'll do[:\s]*(.+?)(?=qualifications|requirements|skills|$)/is,
    /responsibilities[:\s]*(.+?)(?=qualifications|requirements|skills|you'll bring|$)/is,
    /about the role[:\s]*(.+?)(?=qualifications|requirements|skills|$)/is,
  ];
  
  let responsibilities = '';
  for (const pattern of respPatterns) {
    const match = text.match(pattern);
    if (match) {
      const bulletPoints = match[1]
        .split(/[-•·▪▸·]\s*|\n+/)
        .filter((s: string) => s.trim().length > 20 && s.trim().length < 200)
        .slice(0, 5)
        .map((s: string) => s.trim().replace(/<[^>]+>/g, ''))
        .join('|');
      if (bulletPoints) {
        responsibilities = bulletPoints;
        break;
      }
    }
  }
  
  // 提取要求
  const reqPatterns = [
    /qualifications[:\s]*(.+?)(?=nice to have|bonus|preferred|$)/is,
    /requirements[:\s]*(.+?)(?=nice to have|bonus|preferred|$)/is,
    /what you'll bring[:\s]*(.+?)(?=nice to have|bonus|preferred|$)/is,
  ];
  
  let requirements = '';
  for (const pattern of reqPatterns) {
    const match = text.match(pattern);
    if (match) {
      const bulletPoints = match[1]
        .split(/[-•·▪▸·]\s*|\n+/)
        .filter((s: string) => s.trim().length > 10 && s.trim().length < 200)
        .slice(0, 5)
        .map((s: string) => s.trim().replace(/<[^>]+>/g, ''))
        .join('|');
      if (bulletPoints) {
        requirements = bulletPoints;
        break;
      }
    }
  }
  
  // 提取加分项
  const nicePatterns = [
    /nice to have[:\s]*(.+?)(?=|$)/is,
    /bonus[:\s]*(.+?)(?=|$)/is,
    /preferred[:\s]*(.+?)(?=|$)/is,
  ];
  
  let nice_to_have = '';
  for (const pattern of nicePatterns) {
    const match = text.match(pattern);
    if (match) {
      const bulletPoints = match[1]
        .split(/[-•·▪▸·]\s*|\n+/)
        .filter((s: string) => s.trim().length > 10 && s.trim().length < 200)
        .slice(0, 3)
        .map((s: string) => s.trim().replace(/<[^>]+>/g, ''))
        .join('|');
      if (bulletPoints) {
        nice_to_have = bulletPoints;
        break;
      }
    }
  }
  
  return { overview, responsibilities, requirements, nice_to_have };
}

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
  if (/rekrytointi|rekrytering|reclutamiento|rekrutacja|recrute|stellenanzeige|empleo|offre d'emploi|trabajo|pracownik|mitarbeiter|carri.res|carreras/i.test(title)) return false;
  
  // 过滤数字开头的标题
  if (/^\d+[\s,]/.test(title)) return false;
  
  // 过滤招聘列表页/导航页
  if (/^jobs?\s*(at|in|for|@)\s/.test(titleLower)) return false;
  if (/^welcome\s+to/.test(titleLower)) return false;
  if (/experience\s+league|learn\s+with/.test(titleLower)) return false;
  
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
  if (/recruiter|hr|human resources|marketing manager|account executive|account manager|sales representative|customer success|social media|content creator|graphic design/i.test(title)) return false;
  
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

// 验证 URL - 只接受真正的官网岗位页面
function isValidUrl(url: string): boolean {
  const urlLower = url.toLowerCase();
  
  // 过滤噪音网站和猎头
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
    '/research/', '/insights/', '/stories/',
    // 过滤猎头/中介网站
    'falconx', 'hiretalent', 'mercor', 'hired.com', 'toptal', 'gun.io',
    'linkedin.com/jobs/',  // 过滤 LinkedIn（反爬虫）
    'greenhouse.io/apply',  // 过滤过度申请的
  ];
  
  for (const pattern of blockedPatterns) {
    if (urlLower.includes(pattern)) return false;
  }
  
  // 只接受官网域名
  const allowedDomains = [
    // 金融公司官网
    'goldmansachs.com', 
    'morganstanley.com', 
    'jpmorgan.com', 'jpmorganchase.com', 
    'blackrock.com', 
    'bloomberg.com', 
    'citadel.com', 
    'twosigma.com', 
    'janestreet.com', 
    'barclays.com', 
    'deutschebank.com',
    'wellsfargo.com', 
    'bankofamerica.com', 
    'citi.com', 'citigroup.com',
    'ubs.com',
    'vanguard.com', 
    'fidelity.com', 
    'pimco.com', 
    'deshaw.com', 
    'aqr.com',
    // 招聘平台（只接受 ATS 系统）
    'greenhouse.io', 'lever.co', 'workday.com', 'successfactors.com',
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
  const title = rawTitle
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
    const customHeaders = HeaderUtils.extractForwardHeaders({} as Headers);
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
    if (!hasValidAdminSession(request)) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 401 });
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
    const jobsToInsert: Array<{
      title: string;
      company: string;
      region: string;
      url: string;
      description: string;
      direction: string;
      overview: string;
      responsibilities: string;
      requirements: string;
      nice_to_have: string;
    }> = [];

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
              const urlLower = url.toLowerCase();
              
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
              const rawDescription = await fetchJobDescription(url, company, snippet);
              if (rawDescription) {
                results.descriptions++;
              }
              
              // 解析岗位描述为结构化数据
              const parsed = parseJobDescription(rawDescription || snippet, title, company);
              
              jobsToInsert.push({
                title,
                company,
                region,
                url,
                description: rawDescription || title,
                direction,
                overview: parsed.overview,
                responsibilities: parsed.responsibilities,
                requirements: parsed.requirements,
                nice_to_have: parsed.nice_to_have,
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
        overview: job.overview,
        responsibilities: job.responsibilities,
        requirements: job.requirements,
        nice_to_have: job.nice_to_have,
        job_type: job.title.toLowerCase().includes('intern') ? '实习' : '社招',
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
