import { NextRequest, NextResponse } from 'next/server';
import { SearchClient, FetchClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 美国科技独角兽企业
const UNICORN_COMPANIES = [
  'Stripe', 'DoorDash', 'Lyft', 'Dropbox', 'Coinbase', 'Robinhood',
  'Figma', 'Notion', 'Palantir', 'Databricks', 'Snowflake', 
  'Twilio', 'Zoom', 'Atlassian', 'Confluent', 'MongoDB', 
  'Cloudflare', 'Rubrik', 'Scale AI', 'OpenAI', 'Anthropic',
  'Instacart', 'Discord', 'Plaid', 'Brex', 'Datadog', 'GitLab'
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
  if (/rekrytointi|rekruttering|reclutamiento|rekrutacja|recrute|stellenanzeige|empleo|offre d'emploi|trabajo|pracownik|mitarbeiter/i.test(title)) return false;
  
  // 过滤数字开头的标题
  if (/^\d+[\s,]/.test(title)) return false;
  
  // 过滤太通用的标题
  const genericTitles = [
    'software engineer', 'software developer', 'data scientist',
    'machine learning engineer', 'product manager', 'product designer',
    'frontend engineer', 'backend engineer', 'full stack engineer',
    'devops engineer', 'cloud engineer', 'data engineer',
    'python developer', 'java developer', 'ai developer', 'ml engineer',
    'ux designer', 'ux researcher', 'engineering manager'
  ];
  if (genericTitles.includes(titleLower.trim())) return false;
  
  // 过滤非工程类岗位
  if (/fulfillment|account executive|account manager|sales representative|recruiter|hr manager|marketing manager|business development|customer success|technical writer|scrum master|sales director/i.test(title)) return false;
  
  // 过滤个人帖子和列表页
  if (/'s post|post$|hiring|work with us|find new jobs|help us build/i.test(title)) return false;
  
  // 过滤包含 @ 符号（通常是个人账号）
  if (/@\w+/.test(title)) return false;
  
  return true;
}

// 智能分类岗位方向
function classifyDirection(title: string): string {
  const titleLower = title.toLowerCase();
  
  if (/\b(quant|quantitative)\b/.test(titleLower)) return 'Quant';
  if (/\b(risk|fraud|compliance)\b/.test(titleLower)) return 'Risk';
  if (/\b(ibd|investment banking|s&t|sales and trading|trading)\b/.test(titleLower)) return 'IBD/S&T';
  if (/\b(consult|consulting|advisory)\b/.test(titleLower)) return 'Consulting';
  if (/\b(marketing|mkt|sales)\b/.test(titleLower)) return 'MKT';
  if (/\b(product manager|program manager|pm)\b/.test(titleLower)) return 'PM';
  if (/\b(hardware|chip|asic|fpga|silicon)\b/.test(titleLower)) return 'Hardware';
  if (/\b(security|cybersecurity|infosec)\b/.test(titleLower)) return 'Security';
  if (/\b(mle|machine learning engineer|deep learning|nlp|cv|computer vision)\b/.test(titleLower)) return 'ML/AI';
  if (/\b(data scientist|data engineer|analytics|analyst|statistician)\b/.test(titleLower)) return 'Data';
  if (/\b(swe|software engineer|software developer|developer|backend|frontend|fullstack|full-stack|full stack)\b/.test(titleLower)) return 'SDE';
  
  return 'SDE';
}

// 验证 URL
function isValidUrl(url: string): boolean {
  if (!url) return false;
  
  const urlLower = url.toLowerCase();
  
  const blockedPatterns = [
    'zhihu', 'baidu', 'qq.com', '163.com', 'sina', 'sohu.com', 
    'liepin.com', '51job.com', 'zhaopin', 'zhipin.com', 'zhipin',
    'dubclub', 'zensar', 'chels', 'lazer', 'honeysuckle', 'gelato',
    'getro.com', 'goodwillness.com', 'contactout.com',
    'arc.dev', 'builtin.com', 'handwiki.org', '6figr.com', 'ycombinator.com',
    'wiki', 'blog', 'article', '/news/', 'pulse', 'fortune', 'medium.com', 
    'towards data science', 'dev.to', 'hashnode', 'css-tricks',
    'glassdoor', 'indeed', 'simplyhired', 'careerbliss', 'jobrapido',
    'job fairs', 'job listing', 'job alerts', 'job board',
    'linkup', 'linkedin sales navigator', 'recruiter', 'recruiting',
    'job-detail', 'jobDetail', 'job_detail',
  ];
  
  for (const pattern of blockedPatterns) {
    if (urlLower.includes(pattern)) return false;
  }
  
  return true;
}

// 判断是否是美国地区岗位
function isUsJob(url: string): boolean {
  if (!url) return false;
  
  const lower = url.toLowerCase();
  
  const usPatterns = [
    'san francisco', 'seattle', 'new york', 'los angeles', 'austin',
    'boston', 'chicago', 'denver', 'atlanta', 'remote', 'united states',
    '.us', '.com/us', 'jobs.', '/us/', 'us-en', 'en-us',
    'silicon valley', 'bay area', 'nyc', 'la ', 'sf ',
  ];
  
  const nonUsPatterns = [
    'in.linkedin', 'linkedin.cn', 'china.', 'hk.', 'sg.', 'uk.', 'london',
    'berlin', 'paris', 'tokyo', 'sydney', 'toronto', 'vancouver',
    'europe', 'emea', 'apac', 'asia pacific'
  ];
  
  for (const pattern of nonUsPatterns) {
    if (lower.includes(pattern)) return false;
  }
  
  for (const pattern of usPatterns) {
    if (lower.includes(pattern)) return true;
  }
  
  return false;
}

// 验证公司名称
function isValidCompany(title: string, expectedCompanies: string[]): string | null {
  if (!title) return null;
  
  for (const company of expectedCompanies) {
    const regex = new RegExp(`\\b${company}\\b`, 'i');
    const match = title.match(regex);
    if (match) return company;
  }
  return null;
}

// 获取岗位详细描述（仅从官网）
async function fetchJobDescription(url: string): Promise<string> {
  try {
    const fetchClient = new FetchClient();
    const result = await fetchClient.fetch(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    // 提取文本内容
    const text = result.content || '';
    
    // 清理 HTML
    const cleaned = text
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
    
    // 限制长度
    return cleaned.substring(0, 2000);
  } catch (error) {
    return '';
  }
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
      descriptions: 0
    };
    
    const newJobs: any[] = [];
    const seenUrls = new Set<string>();
    
    // 搜索每个独角兽企业的岗位
    for (const company of UNICORN_COMPANIES) {
      console.log(`Searching jobs for ${company}...`);
      
      try {
        const queries = [
          `${company} software engineer jobs United States`,
          `${company} senior developer jobs openings`,
        ];

        for (const query of queries.slice(0, 2)) {
          try {
            const response = await client.webSearch(query, 8, false);

            if (response.web_items && response.web_items.length > 0) {
              for (const item of response.web_items || []) {
                const url = item.url || '';
                
                if (!url || seenUrls.has(url)) continue;
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
                let title = item.title || '';
                
                // 验证标题
                if (!isValidTitle(title) || !title) {
                  results.invalid++;
                  continue;
                }
                
                // 检查公司名称
                const matchedCompany = isValidCompany(title, [company]);
                if (!matchedCompany) {
                  results.invalid++;
                  continue;
                }
                
                newJobs.push({
                  title,
                  company: matchedCompany,
                  region: 'United States',
                  direction: classifyDirection(title),
                  audience: '留学生',
                  description: item.snippet || title,
                  requirements: '',
                  salary_range: '',
                  job_url: url,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                });
                
                results.total++;
              }
            }

            await new Promise(resolve => setTimeout(resolve, 500));
            
          } catch (error) {
            console.error(`Search error:`, error);
            results.skipped++;
          }
        }
      } catch (error) {
        console.error(`Error searching ${company}:`, error);
        results.skipped++;
      }
      
      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // 批量插入新岗位
    if (newJobs.length > 0) {
      const { error } = await supabase.from('jobs').insert(newJobs);
      if (error) {
        console.error('Error inserting jobs:', error);
        results.failed += newJobs.length;
      } else {
        results.success = newJobs.length;
      }
    }
    
    console.log('Sync completed:', results);
    
    return NextResponse.json({
      success: results.success > 0,
      message: `同步完成：新增 ${results.success} 个独角兽岗位`,
      results
    });
    
  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json(
      { error: '同步失败', details: String(error) },
      { status: 500 }
    );
  }
}
