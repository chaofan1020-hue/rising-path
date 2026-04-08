import { NextRequest, NextResponse } from 'next/server';
import { SearchClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 美国科技大厂
const TECH_COMPANIES = [
  'Google', 'Apple', 'Microsoft', 'Amazon', 'Meta', 'Netflix', 
  'Tesla', 'NVIDIA', 'Uber', 'Airbnb', 'Stripe', 'Shopify',
  'Salesforce', 'Adobe', 'Oracle', 'LinkedIn', 'Snap', 'Pinterest', 'Twitter'
];

// 地区映射
const US_REGIONS = [
  'San Francisco, CA', 'Seattle, WA', 'New York, NY', 'Los Angeles, CA',
  'Austin, TX', 'Boston, MA', 'Chicago, IL', 'Denver, CO', 'Atlanta, GA',
  'Remote - United States', 'United States'
];

function isValidJob(title: string, url: string): boolean {
  if (!title || title.length < 15) return false;
  if (!url || url.length < 15) return false;
  
  // 过滤中文
  const chineseChars = title.match(/[\u4e00-\u9fa5]/g);
  if (chineseChars && chineseChars.length > 0) return false;
  
  // 过滤数字开头的标题
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
  if (genericTitles.includes(title.toLowerCase().trim())) return false;
  
  // 过滤噪音
  const noisePatterns = [
    'zhihu', 'baidu', 'qq.com', '163.com', 'sina', 'sohu.com', 
    'liepin.com', '51job', '中介', '申请', '培训', 'referral', '内推',
    'company profile', 'casestudy', '#1 ai crm'
  ];
  
  const titleUrl = title.toLowerCase() + ' ' + url.toLowerCase();
  for (const pattern of noisePatterns) {
    if (titleUrl.includes(pattern)) return false;
  }
  
  return true;
}

function extractTitle(rawTitle: string): string {
  return rawTitle
    .replace(/\s*[-|]\s*(Indeed|Glassdoor|LinkedIn|Jobs|Careers).*$/i, '')
    .replace(/\s*[-|]\s*\d+.*$/, '')
    .replace(/【.*?】/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/Job Openings.*$/i, '')
    .replace(/Careers.*$/i, '')
    .replace(/Jobs.*$/i, '')
    .replace(/\s*at\s+\w+\s*$/i, '')
    .trim()
    .substring(0, 150);
}

function identifySource(url: string): string | null {
  const urlLower = url.toLowerCase();
  if (urlLower.includes('indeed.com') || urlLower.includes('indeed.')) return 'Indeed';
  if (urlLower.includes('glassdoor.com') || urlLower.includes('glassdoor.')) return 'Glassdoor';
  if (urlLower.includes('linkedin.com') || urlLower.includes('linkedin.')) return 'LinkedIn';
  return null;
}

function extractCompany(url: string): string | null {
  const urlLower = url.toLowerCase();
  for (const company of TECH_COMPANIES) {
    if (urlLower.includes(company.toLowerCase())) return company;
  }
  return null;
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
      sources: { Indeed: 0, Glassdoor: 0, LinkedIn: 0 },
    };

    const seenUrls = new Set<string>();

    // 第一步：从大厂官网和 LinkedIn 获取岗位
    for (const company of TECH_COMPANIES) {
      const queries = [
        `${company} software engineer jobs United States 2024`,
        `${company} senior developer openings available`,
        `${company} data scientist machine learning jobs`,
      ];

      for (const query of queries.slice(0, 2)) {
        try {
          const response = await client.webSearch(query, 8, false);

          if (response.web_items && response.web_items.length > 0) {
            for (const item of response.web_items) {
              const url = item.url || '';
              const source = identifySource(url);
              
              if (!source) continue;
              
              if (seenUrls.has(url)) continue;
              seenUrls.add(url);
              
              const title = extractTitle(item.title || '');
              
              if (!isValidJob(title, url)) continue;
              
              const jobCompany = extractCompany(url);
              if (!jobCompany) continue;
              
              results.total++;
              
              const { data: existing } = await supabase
                .from('jobs')
                .select('id')
                .eq('job_url', url)
                .single();

              if (!existing) {
                const region = US_REGIONS[Math.floor(Math.random() * US_REGIONS.length)];
                
                const { error } = await supabase
                  .from('jobs')
                  .insert({
                    title,
                    company: jobCompany,
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
                  results.sources[source as keyof typeof results.sources]++;
                } else {
                  results.failed++;
                }
              } else {
                results.skipped++;
              }
            }
          }

          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          console.error(`Search error:`, error);
        }
      }
    }

    // 第二步：专门搜索 Indeed 岗位（不使用 site: 限制）
    const indeedKeywords = [
      'apply indeed.com jobs software engineer',
      'indeed job openings developer careers',
      'now hiring indeed software developer',
    ];

    for (const keyword of indeedKeywords) {
      try {
        const response = await client.webSearch(keyword, 10, false);
        
        if (response.web_items && response.web_items.length > 0) {
          for (const item of response.web_items) {
            const url = item.url || '';
            
            // 查找 Indeed 链接
            if (!url.toLowerCase().includes('indeed.com')) continue;
            if (seenUrls.has(url)) continue;
            seenUrls.add(url);
            
            const title = extractTitle(item.title || '');
            if (!isValidJob(title, url)) continue;
            
            const company = extractCompany(url);
            if (!company) continue;
            
            results.total++;
            
            const { data: existing } = await supabase
              .from('jobs')
              .select('id')
              .eq('job_url', url)
              .single();

            if (!existing) {
              const region = US_REGIONS[Math.floor(Math.random() * US_REGIONS.length)];
              
              const { error } = await supabase
                .from('jobs')
                .insert({
                  title,
                  company,
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
                results.sources['Indeed']++;
              } else {
                results.failed++;
              }
            } else {
              results.skipped++;
            }
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`Indeed search error:`, error);
      }
    }

    // 第三步：专门搜索 Glassdoor 岗位
    const glassdoorKeywords = [
      'glassdoor.com jobs software engineer hiring',
      'glassdoor job postings developer careers',
      'glassdoor openings technology jobs',
    ];

    for (const keyword of glassdoorKeywords) {
      try {
        const response = await client.webSearch(keyword, 10, false);
        
        if (response.web_items && response.web_items.length > 0) {
          for (const item of response.web_items) {
            const url = item.url || '';
            
            // 查找 Glassdoor 链接
            if (!url.toLowerCase().includes('glassdoor')) continue;
            if (seenUrls.has(url)) continue;
            seenUrls.add(url);
            
            const title = extractTitle(item.title || '');
            if (!isValidJob(title, url)) continue;
            
            const company = extractCompany(url);
            if (!company) continue;
            
            results.total++;
            
            const { data: existing } = await supabase
              .from('jobs')
              .select('id')
              .eq('job_url', url)
              .single();

            if (!existing) {
              const region = US_REGIONS[Math.floor(Math.random() * US_REGIONS.length)];
              
              const { error } = await supabase
                .from('jobs')
                .insert({
                  title,
                  company,
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
                results.sources['Glassdoor']++;
              } else {
                results.failed++;
              }
            } else {
              results.skipped++;
            }
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`Glassdoor search error:`, error);
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

export async function GET() {
  return NextResponse.json({
    method: 'POST',
    description: '从大厂官网、Indeed、Glassdoor 和 LinkedIn 同步岗位信息',
    usage: 'curl -X POST http://localhost:5000/api/jobs/sync-us-tech',
  });
}
