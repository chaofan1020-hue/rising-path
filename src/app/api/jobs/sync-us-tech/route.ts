import { NextRequest, NextResponse } from 'next/server';
import { SearchClient, FetchClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 美国科技大厂
const TECH_COMPANIES = [
  'Google', 'Apple', 'Microsoft', 'Amazon', 'Meta', 'Netflix', 
  'Tesla', 'NVIDIA', 'Uber', 'Airbnb', 'Stripe', 'Shopify',
  'Salesforce', 'Adobe', 'Oracle', 'LinkedIn', 'Snap', 'Pinterest', 'Twitter', 'X'
];

// 只保留美国主要地区
const US_REGIONS = [
  'San Francisco, CA', 'Seattle, WA', 'New York, NY', 'Los Angeles, CA',
  'Austin, TX', 'Boston, MA', 'Chicago, IL', 'Denver, CO', 'Atlanta, GA',
  'Remote - United States', 'United States'
];

// 验证岗位标题
function isValidTitle(title: string): boolean {
  if (!title || title.length < 15) return false;
  
  const titleLower = title.toLowerCase();
  
  // 过滤中文
  if (/[\u4e00-\u9fa5]/.test(title)) return false;
  
  // 过滤非英语语言特征
  if (/rekrytointi|rekrytering|reclutamiento|rekrutacja|recrute|stellenanzeige|empleo|offre d'emploi|trabajo|pracownik|mitarbeiter/i.test(title)) return false;
  
  // 过滤数字开头的标题
  if (/^\d+[\s,]/.test(title)) return false;
  
  // 过滤太通用的标题
  const genericTitles = [
    'software engineer', 'software developer', 'data scientist',
    'machine learning engineer', 'product manager', 'product designer',
    'frontend engineer', 'backend engineer', 'full stack engineer',
    'devops engineer', 'cloud engineer', 'data engineer',
    'python developer', 'java developer', 'ai developer', 'ml engineer',
    'ux designer', 'ux researcher', 'engineering manager',
    'senior software engineer', 'senior software developer', 'junior developer'
  ];
  if (genericTitles.includes(titleLower.trim())) return false;
  
  // 过滤非工程类岗位
  if (/fulfillment by amazon|selling partner|account executive|account manager|sales representative|recruiter|hr manager|marketing manager|business development|customer success|technical writer|program manager|scrum master|sales director/i.test(title)) return false;
  
  // 过滤个人帖子和列表页
  if (/'s post|post$|hiring|work with us|find new jobs|agentforce|careers in|help us build/i.test(title)) return false;
  
  // 过滤包含 @ 符号（通常是个人账号）
  if (/@\w+/.test(title)) return false;
  
  return true;
}

// 智能分类岗位方向
function classifyDirection(title: string): string {
  const titleLower = title.toLowerCase();
  
  // 优先匹配更具体的方向
  if (/\b(quant|quantitative)\b/.test(titleLower)) return 'Quant';
  if (/\b(pm|product manager|program manager)\b/.test(titleLower)) return 'PM';
  if (/\b(research scientist|researcher|applied scientist)\b/.test(titleLower)) return 'Research';
  if (/\b(risk|fraud|compliance)\b/.test(titleLower)) return 'Risk';
  if (/\b(legal|counsel|attorney)\b/.test(titleLower)) return 'Legal';
  if (/\b(finance|accounting|controller)\b/.test(titleLower)) return 'Finance';
  if (/\b(marketing|sales|business development)\b/.test(titleLower)) return 'Marketing';
  if (/\b(designer|ux|ui|product designer)\b/.test(titleLower)) return 'Design';
  if (/\b(mle|machine learning engineer|deep learning|nlp|cv|computer vision)\b/.test(titleLower)) return 'MLE';
  if (/\b(data scientist|data engineer|analytics|analyst|statistician)\b/.test(titleLower)) return 'Data';
  if (/\b(sre|site reliability|infrastructure|platform|security)\b/.test(titleLower)) return 'SRE';
  if (/\b(mobile|ios|android|flutter|react native)\b/.test(titleLower)) return 'Mobile';
  if (/\b(frontend|front-end|front end|ui developer)\b/.test(titleLower)) return 'Frontend';
  if (/\b(backend|back-end|back end|distributed|systems)\b/.test(titleLower)) return 'Backend';
  if (/\b(fullstack|full-stack|full stack|fullstack)\b/.test(titleLower)) return 'Fullstack';
  if (/\b(swe|software engineer|software developer|developer)\b/.test(titleLower)) return 'SDE';
  
  // 默认 Tech
  return 'Tech';
}

// 验证 URL
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
    'youtube.com', 'casestudy', 'comparisons'
  ];
  
  for (const pattern of blockedPatterns) {
    if (urlLower.includes(pattern)) return false;
  }
  
  // 允许的域名
  const allowedDomains = [
    'careers.google.com', 'jobs.apple.com', 'careers.microsoft.com', 'amazon.jobs',
    'metacareers.com', 'jobs.netflix.com', 'tesla.com', 'nvidia.com',
    'uber.com', 'airbnb.com', 'stripe.com', 'shopify.com', 'salesforce.com',
    'adobe.com', 'oracle.com', 'snap.com', 'pinterest.com',
    'twitter.com', 'indeed.com', 'glassdoor.com', 'greenhouse.io', 'lever.co',
    'linkedin.com'
  ];
  
  return allowedDomains.some(domain => urlLower.includes(domain));
}

// 过滤非美国地区
function isUsJob(url: string): boolean {
  const urlLower = url.toLowerCase();
  const countryPatterns = ['/tw/', '/cn/', '/hk/', '/sg/', '/uk/', '/de/', '/fr/', '/au/', '/in/', '/jp/', '/kr/'];
  
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
    .replace(new RegExp(`^(Google|Apple|Microsoft|Amazon|Meta|Netflix|Tesla|NVIDIA|Uber|Airbnb|Stripe|Shopify|Salesforce|Adobe|Oracle|LinkedIn|Snap|Pinterest|Twitter|X)\\s+hiring\\s+`, 'i'), '')
    .replace(/\s*[-|]\s*(LinkedIn|Glassdoor|Indeed|Jobs|Careers).*$/i, '')
    .replace(/\s+at\s+(Google|Apple|Microsoft|Amazon|Meta|Netflix|Tesla|NVIDIA|Uber|Airbnb|Stripe|Shopify|Salesforce|Adobe|Oracle|LinkedIn|Snap|Pinterest|Twitter|X)\s*$/i, '')
    .replace(/['"']s (post|Post)$/i, '')
    .replace(/^(Job Alert: |New: )/i, '')
    .trim();
  
  return title.substring(0, 150);
}

// 获取真实岗位描述（仅官网）
async function fetchJobDescription(url: string, company: string): Promise<string> {
  const urlLower = url.toLowerCase();
  
  // 定义官网域名
  const officialDomains: Record<string, string[]> = {
    'Google': ['careers.google.com'],
    'Apple': ['jobs.apple.com'],
    'Microsoft': ['careers.microsoft.com'],
    'Amazon': ['amazon.jobs'],
    'Meta': ['metacareers.com'],
    'Netflix': ['jobs.netflix.com'],
    'Tesla': ['tesla.com/careers'],
    'NVIDIA': ['nvidia.com'],
    'Uber': ['uber.com/careers'],
    'Airbnb': ['airbnb.com/careers'],
    'Stripe': ['stripe.com/jobs'],
    'Shopify': ['shopify.com/careers'],
    'Salesforce': ['salesforce.com'],
    'Adobe': ['adobe.com/careers'],
    'Oracle': ['oracle.com/careers'],
    'Snap': ['snap.com/jobs'],
    'Pinterest': ['pinterestcareers.com'],
    'Twitter': ['careers.twitter.com'],
    'X': ['careers.twitter.com'],
  };
  
  const domains = officialDomains[company] || [];
  const isOfficial = domains.some(domain => urlLower.includes(domain));
  
  // 只有官网才获取详细描述
  if (!isOfficial) {
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
      
      return textContent;
    }
  } catch (error) {
    console.error('Fetch error:', error);
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
    const jobsToInsert: Array<{ title: string; company: string; region: string; url: string; description: string }> = [];

    for (const company of TECH_COMPANIES) {
      const queries = [
        `${company} software engineer jobs United States`,
        `${company} senior developer jobs openings`,
      ];

      for (const query of queries.slice(0, 2)) {
        try {
          const response = await client.webSearch(query, 8, false);

          if (response.web_items && response.web_items.length > 0) {
            for (const item of response.web_items) {
              const url = item.url || '';
              
              if (seenUrls.has(url)) continue;
              seenUrls.add(url);
              
              // 验证 URL
              if (!isValidUrl(url)) {
                results.invalid++;
                continue;
              }
              
              // 过滤非美国岗位
              if (!isUsJob(url)) {
                results.invalid++;
                continue;
              }
              
              // 提取标题
              let title = extractTitle(item.title || '', company);
              
              // 验证标题
              if (!isValidTitle(title)) {
                results.invalid++;
                continue;
              }
              
              jobsToInsert.push({
                title,
                company,
                region: US_REGIONS[Math.floor(Math.random() * US_REGIONS.length)],
                url,
                description: (item.snippet || '').substring(0, 300),
              });
              
              results.total++;
            }
          }

          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          console.error(`Search error:`, error);
        }
      }
    }

    // 批量插入岗位并获取真实描述
    for (const job of jobsToInsert) {
      const { data: existing } = await supabase
        .from('jobs')
        .select('id')
        .eq('job_url', job.url)
        .single();

      if (!existing) {
        // 获取官网详细描述
        const realDescription = await fetchJobDescription(job.url, job.company);
        if (realDescription) {
          job.description = realDescription;
          results.descriptions++;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        const { error } = await supabase
          .from('jobs')
          .insert({
            title: job.title,
            company: job.company,
            region: job.region,
            direction: classifyDirection(job.title), // 智能分类方向
            audience: '留学生',
            description: job.description,
            requirements: '',
            salary_range: '',
            job_url: job.url,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

        if (!error) {
          results.success++;
        } else {
          results.failed++;
        }
      } else {
        results.skipped++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `同步完成：新增 ${results.success} 个岗位，获取 ${results.descriptions} 个详细描述`,
      results,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json(
      { error: '同步失败', details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    method: 'POST',
    description: '同步美国科技大厂岗位',
    usage: 'curl -X POST http://localhost:5000/api/jobs/sync-us-tech',
  });
}
