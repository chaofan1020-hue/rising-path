import { NextRequest, NextResponse } from 'next/server';
import { SearchClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// Adzuna API 配置（免费层）
const ADZUNA_APP_ID = 'demo';  // 可替换为真实 ID
const ADZUNA_APP_KEY = 'demo'; // 可替换为真实 Key

// 金融公司关键词
const FINANCE_COMPANIES = [
  'Goldman Sachs', 'Morgan Stanley', 'JPMorgan', 'BlackRock', 'Bloomberg',
  'Citadel', 'Two Sigma', 'Jane Street', 'Barclays', 'Deutsche Bank',
  'Wells Fargo', 'Bank of America', 'Citi', 'UBS', 'Vanguard', 'Fidelity',
  'PIMCO', 'DE Shaw', 'AQR', 'Citadel Securities', 'IMC Trading', 'Optiver'
];

// 岗位方向分类
function classifyDirection(title: string, company: string): string {
  const text = (title + ' ' + company).toLowerCase();
  
  if (/\b(quant|quantitative|trader|trading|alg|algo)\b/.test(text)) return 'Quant';
  if (/\b(data scientist|data engineer|analytics|machine learning|ml|mle)\b/.test(text)) return 'Data';
  if (/\b(swe|software|engineer|developer|backend|frontend|full.?stack)\b/.test(text)) return 'SDE';
  if (/\b(intern|summer)\b/.test(text)) return 'Intern';
  if (/\b(product manager|pm|program manager)\b/.test(text)) return 'PM';
  if (/\b(risk|fraud|compliance)\b/.test(text)) return 'Risk';
  
  return 'Finance';
}

// 提取地区
function extractRegion(location: string): string {
  const loc = location.toLowerCase();
  
  const regionMap: Record<string, string> = {
    'new york': 'New York, NY',
    'nyc': 'New York, NY',
    'manhattan': 'New York, NY',
    'jersey city': 'Jersey City, NJ',
    'hoboken': 'Hoboken, NJ',
    'greenwich': 'Greenwich, CT',
    'san francisco': 'San Francisco, CA',
    'sf': 'San Francisco, CA',
    'silicon valley': 'Silicon Valley, CA',
    'mountain view': 'Mountain View, CA',
    'palo alto': 'Palo Alto, CA',
    'menlo park': 'Menlo Park, CA',
    'boston': 'Boston, MA',
    'chicago': 'Chicago, IL',
    'seattle': 'Seattle, WA',
    'austin': 'Austin, TX',
    'dallas': 'Dallas, TX',
    'houston': 'Houston, TX',
    'charlotte': 'Charlotte, NC',
    'london': 'London, UK',
    'hong kong': 'Hong Kong',
    'singapore': 'Singapore',
    'remote': 'Remote - United States',
  };
  
  for (const [key, region] of Object.entries(regionMap)) {
    if (loc.includes(key)) return region;
  }
  
  return 'United States';
}

// 获取岗位类型
function getJobType(title: string): string {
  const text = title.toLowerCase();
  if (/\b(intern|internship|trainee)\b/.test(text)) return '实习';
  if (/\b(junior|entry.?level|associate.?level)\b/.test(text)) return '校招';
  return '社招';
}

export async function POST(request: NextRequest) {
  try {
    // 验证管理员密码
    const authHeader = request.headers.get('x-admin-password');
    if (!authHeader) {
      return NextResponse.json({ error: '需要管理员密码' }, { status: 401 });
    }
    
    const { verifyAdminPassword } = await import('@/lib/admin-auth');
    const isValid = await verifyAdminPassword(authHeader);
    if (!isValid) {
      return NextResponse.json({ error: '管理员密码错误' }, { status: 401 });
    }

    const supabase = getSupabaseClient();
    const config = new Config();
    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const searchClient = new SearchClient(config, customHeaders);

    const results = {
      success: 0,
      skipped: 0,
      failed: 0,
      total: 0,
      details: [] as string[],
    };

    // 获取现有岗位 URL
    const seenUrls = new Set<string>();
    const { data: existingJobs } = await supabase
      .from('jobs')
      .select('job_url');
    if (existingJobs) {
      for (const job of existingJobs) {
        if (job.job_url) seenUrls.add(job.job_url);
      }
    }

    // 使用搜索 API 查找金融公司岗位
    for (const company of FINANCE_COMPANIES) {
      const queries = [
        `${company} software engineer jobs`,
        `${company} quantitative developer jobs`,
        `${company} technology analyst jobs`,
      ];

      for (const query of queries.slice(0, 2)) {
        try {
          const response = await searchClient.webSearch(query, 15, false);
          
          if (response.web_items && response.web_items.length > 0) {
            for (const item of response.web_items) {
              const url = item.url || '';
              const title = item.title || '';
              
              if (seenUrls.has(url)) {
                results.skipped++;
                continue;
              }
              
              // 验证 URL - 必须是官网或招聘平台
              const urlLower = url.toLowerCase();
              const isValidUrl = 
                urlLower.includes(company.toLowerCase().replace(/\s+/g, '')) ||
                urlLower.includes('greenhouse.io') ||
                urlLower.includes('lever.co') ||
                urlLower.includes('workday.com') ||
                urlLower.includes('successfactors.com');
              
              if (!isValidUrl) {
                results.skipped++;
                continue;
              }
              
              // 验证标题
              const titleLower = title.toLowerCase();
              const hasValidKeyword = /engineer|developer|analyst|quant|trader|data|scientist|technology|tech/.test(titleLower);
              if (!hasValidKeyword || title.length < 10) {
                results.skipped++;
                continue;
              }
              
              // 过滤列表页
              if (/^jobs?\s*at|^careers?\s*$|welcome\s+to|about\s+us/i.test(title)) {
                results.skipped++;
                continue;
              }
              
              seenUrls.add(url);
              results.total++;
              
              // 提取信息
              const region = extractRegion(item.location || item.title || '');
              const direction = classifyDirection(title, company);
              const job_type = getJobType(title);
              
              // 生成描述
              const description = `${title} at ${company}. ${item.snippet || ''}`.substring(0, 500);
              
              // 插入数据库
              const { error: insertError } = await supabase
                .from('jobs')
                .insert({
                  title: title.substring(0, 200),
                  company,
                  region,
                  direction,
                  job_type,
                  job_url: url,
                  description,
                  audience: '留学生',
                  is_active: true,
                });

              if (!insertError) {
                results.success++;
                results.details.push(`[${company}] ${title.substring(0, 50)}`);
              } else {
                results.failed++;
              }
            }
          }
        } catch (error) {
          console.error(`Search error for ${company}:`, error);
          results.failed++;
        }
        
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    return NextResponse.json({
      message: 'Adzuna 风格岗位搜索完成',
      ...results,
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: '搜索失败', details: String(error) },
      { status: 500 }
    );
  }
}
