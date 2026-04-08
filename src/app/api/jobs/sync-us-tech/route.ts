import { NextRequest, NextResponse } from 'next/server';
import { SearchClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 美国科技大厂 - 精准搜索策略
const US_TECH_COMPANIES = [
  { 
    name: 'Google', 
    careersUrl: 'https://careers.google.com/',
    queries: [
      'site:careers.google.com software engineer',
      'site:careers.google.com data scientist'
    ]
  },
  { 
    name: 'Apple', 
    careersUrl: 'https://jobs.apple.com/',
    queries: [
      'site:jobs.apple.com software engineer',
      'site:apple.com careers software'
    ]
  },
  { 
    name: 'Microsoft', 
    careersUrl: 'https://careers.microsoft.com/',
    queries: [
      'site:careers.microsoft.com software engineer',
      'site:Microsoft.com jobs software'
    ]
  },
  { 
    name: 'Amazon', 
    careersUrl: 'https://amazon.jobs/',
    queries: [
      'site:amazon.jobs software development engineer',
      'site:amazon.jobs data scientist'
    ]
  },
  { 
    name: 'Meta', 
    careersUrl: 'https://www.metacareers.com/',
    queries: [
      'site:metacareers.com software engineer',
      'site:meta.com careers software'
    ]
  },
  { 
    name: 'Netflix', 
    careersUrl: 'https://jobs.netflix.com/',
    queries: [
      'site:jobs.netflix.com software engineer',
      'site:netflix.com jobs engineering'
    ]
  },
  { 
    name: 'NVIDIA', 
    careersUrl: 'https://nvidia.com/careers',
    queries: [
      'site:nvidia.com careers software',
      'site:nvidia.com careers engineer'
    ]
  },
  { 
    name: 'Tesla', 
    careersUrl: 'https://www.tesla.com/careers',
    queries: [
      'site:tesla.com careers software engineer',
      'site:tesla.com careers engineering'
    ]
  },
  { 
    name: 'Uber', 
    careersUrl: 'https://www.uber.com/careers/',
    queries: [
      'site:uber.com careers software engineer',
      'site:uber.com jobs engineering'
    ]
  },
  { 
    name: 'Airbnb', 
    careersUrl: 'https://www.airbnb.com/careers',
    queries: [
      'site:airbnb.com careers software',
      'site:airbnb.com jobs engineering'
    ]
  },
  { 
    name: 'Stripe', 
    careersUrl: 'https://stripe.com/jobs',
    queries: [
      'site:stripe.com jobs software',
      'site:stripe.com careers engineer'
    ]
  },
  { 
    name: 'Shopify', 
    careersUrl: 'https://www.shopify.com/careers',
    queries: [
      'site:shopify.com careers software engineer',
      'site:shopify.com jobs engineering'
    ]
  },
  { 
    name: 'Salesforce', 
    careersUrl: 'https://www.salesforce.com/company/careers/',
    queries: [
      'site:salesforce.com careers software engineer',
      'site:salesforce.com jobs engineering'
    ]
  },
  { 
    name: 'Adobe', 
    careersUrl: 'https://www.adobe.com/careers.html',
    queries: [
      'site:adobe.com careers software',
      'site:adobe.com careers engineer'
    ]
  },
  { 
    name: 'Oracle', 
    careersUrl: 'https://www.oracle.com/careers/',
    queries: [
      'site:oracle.com careers software engineer',
      'site:oracle.com jobs engineering'
    ]
  },
  { 
    name: 'LinkedIn', 
    careersUrl: 'https://careers.linkedin.com/',
    queries: [
      'site:linkedin.com careers software engineer',
      'site:linkedin.com jobs engineering'
    ]
  },
  { 
    name: 'Microsoft', 
    careersUrl: 'https://careers.microsoft.com/',
    queries: [
      'site:careers.linkedin.com microsoft'
    ]
  },
  { 
    name: 'Snap', 
    careersUrl: 'https://www.snap.com/jobs/',
    queries: [
      'site:snap.com jobs software engineer',
      'site:snap.com careers engineering'
    ]
  },
  { 
    name: 'Pinterest', 
    careersUrl: 'https://www.pinterestcareers.com/',
    queries: [
      'site:pinterestcareers.com software engineer',
      'site:pinterest.com careers engineering'
    ]
  },
  { 
    name: 'Twitter', 
    careersUrl: 'https://careers.twitter.com/',
    queries: [
      'site:careers.twitter.com software engineer',
      'site:x.com careers engineering'
    ]
  },
];

// 地区映射
const US_REGIONS = [
  'San Francisco, CA', 'Seattle, WA', 'New York, NY', 'Los Angeles, CA',
  'Austin, TX', 'Boston, MA', 'Chicago, IL', 'Denver, CO', 'Atlanta, GA',
  'Remote - United States', 'United States'
];

// 判断是否为有效岗位
function isValidJob(title: string, url: string): boolean {
  if (!title || title.length < 15) return false;
  if (!url || url.length < 15) return false;
  
  // 过滤非英文标题
  const chineseChars = title.match(/[\u4e00-\u9fa5]/g);
  if (chineseChars && chineseChars.length > 0) return false;
  
  // 过滤包含数字开头的通用标题（如 "119,000+ Junior Software Engineer"）
  if (/^\d+[\s,]/.test(title)) return false;
  
  // 过滤太通用的标题
  const genericTitles = [
    'software engineer', 'software developer', 'data scientist',
    'machine learning engineer', 'product manager', 'product designer',
    'frontend engineer', 'backend engineer', 'full stack engineer',
    'devops engineer', 'cloud engineer', 'data engineer',
    'python developer', 'python engineer', 'java developer',
    'ai developer', 'ml engineer', 'ux designer', 'ux researcher'
  ];
  const titleLower = title.toLowerCase().trim();
  if (genericTitles.includes(titleLower)) return false;
  
  // 过滤公司名作为标题的
  const companyOnly = [
    'google', 'apple', 'microsoft', 'amazon', 'meta', 'netflix',
    'tesla', 'nvidia', 'uber', 'airbnb', 'stripe', 'shopify',
    'salesforce', 'adobe', 'oracle', 'linkedin', 'snap', 'twitter'
  ];
  if (companyOnly.includes(titleLower)) return false;
  
  // 过滤噪音关键词
  const noisePatterns = [
    'blog', 'news', 'article', 'medium.com', 'zhihu', 'baidu', 'qq.com', 
    '163.com', 'sina', 'sohu.com', 'juesheng', 'liepin.com', '51job',
    '中介', '申请', '培训', '实习', 'referral', '内推', 'youtube',
    'landing', 'about', 'overview', 'benefits', 'culture', 'faq',
    'pulse', 'fortune', 'indeed', 'glassdoor', 'how-to', 'consulting',
    'freelancer', 'contractor', 'mindfriend', 'informationen',
    'company profile', 'jobber', 'case', 'study', 'casestudy',
    '#1 ai crm', 'discover your place', 'workflow automation'
  ];
  
  const urlLower = url.toLowerCase();
  const titleUrl = title.toLowerCase() + ' ' + urlLower;
  for (const pattern of noisePatterns) {
    if (titleUrl.includes(pattern)) return false;
  }
  
  // 过滤特殊字符过多的标题
  if (title.includes('////') || title.includes('|||') || title.length > 150) {
    return false;
  }
  
  return true;
}

// 提取岗位标题
function extractTitle(rawTitle: string, companyName: string): string {
  return rawTitle
    .replace(new RegExp(`\\s*[-|]\\s*${companyName}.*$`, 'i'), '')
    .replace(/\s*[-|]\s*LinkedIn$/i, '')
    .replace(/\s*[-|]\s*Indeed$/i, '')
    .replace(/\s*[-|]\s*Glassdoor$/i, '')
    .replace(/\s*正在招聘.*$/, '')
    .replace(/\s*招聘.*$/, '')
    .replace(/【.*?】/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/Job Openings.*$/i, '')
    .replace(/Careers.*$/i, '')
    .replace(/Jobs.*$/i, '')
    .replace(/Hiring.*$/i, '')
    .trim()
    .substring(0, 150);
}

export async function POST(request: NextRequest) {
  try {
    const config = new Config();
    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const client = new SearchClient(config, customHeaders);
    const supabase = getSupabaseClient();

    const results = {
      success: 0,
      skipped: 0,
      failed: 0,
      total: 0,
      details: [] as string[],
    };

    // 去重 URL 集合
    const seenUrls = new Set<string>();

    // 遍历每个公司
    for (const company of US_TECH_COMPANIES) {
      let companySuccess = 0;
      
      // 使用每个查询搜索
      for (const query of company.queries) {
        try {
          const response = await client.webSearch(query, 10, false);

          if (response.web_items && response.web_items.length > 0) {
            for (const item of response.web_items) {
              const url = item.url || '';
              
              // 去重
              if (seenUrls.has(url)) continue;
              seenUrls.add(url);
              
              const title = extractTitle(item.title || '', company.name);
              
              if (!isValidJob(title, url)) continue;
              
              // 验证 URL 包含公司域名
              const companyDomain = company.name.toLowerCase().replace(/\s+/g, '');
              const urlLower = url.toLowerCase();
              const hasCompanyDomain = 
                urlLower.includes(company.name.toLowerCase()) ||
                urlLower.includes(companyDomain);
              
              if (!hasCompanyDomain) continue;
              
              results.total++;
              
              // 检查是否已存在
              const { data: existing } = await supabase
                .from('jobs')
                .select('id')
                .eq('job_url', url)
                .single();

              if (!existing) {
                // 随机分配地区
                const region = US_REGIONS[Math.floor(Math.random() * US_REGIONS.length)];
                
                const { error } = await supabase
                  .from('jobs')
                  .insert({
                    title,
                    company: company.name,
                    region,
                    direction: 'Tech',
                    audience: '留学生',
                    description: (item.snippet || '').substring(0, 500),
                    requirements: '',
                    salary_range: '',
                    job_url: url,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  });

                if (!error) {
                  results.success++;
                  companySuccess++;
                } else {
                  results.failed++;
                }
              } else {
                results.skipped++;
              }
            }
          }

          // 避免请求过快
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          console.error(`Error searching "${query}":`, error);
        }
      }
      
      if (companySuccess > 0) {
        results.details.push(`${company.name}: ${companySuccess}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: '岗位同步完成',
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

export async function GET(request: NextRequest) {
  return NextResponse.json({
    method: 'POST',
    description: '同步美国科技大厂岗位信息',
    usage: 'curl -X POST https://your-domain.com/api/jobs/sync-us-tech',
  });
}
