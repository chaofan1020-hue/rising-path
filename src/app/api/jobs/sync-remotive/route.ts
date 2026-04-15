import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// Remotive API - 专注于 Remote 工作的免费 API
const REMOTIVE_API = 'https://remotive.com/api/remote-jobs';

// 金融相关关键词
const FINANCE_KEYWORDS = [
  'finance', 'financial', 'trading', 'quant', 'quantitative',
  'banking', 'investment', 'fintech', 'blockchain', 'crypto',
  'accounting', 'economist', 'risk', 'compliance', 'audit',
  'data analyst', 'data scientist', 'software engineer', 'developer',
  'machine learning', 'AI', 'backend', 'frontend', 'full stack'
];

// 金融公司
const FINANCE_COMPANIES = [
  'goldman sachs', 'morgan stanley', 'jpmorgan', 'jp morgan',
  'blackrock', 'bloomberg', 'citadel', 'two sigma', 'jane street',
  'barclays', 'deutsche bank', 'wells fargo', 'bank of america',
  'citi', 'ubs', 'vanguard', 'fidelity', ' pimco', 'de shaw', 'aqr'
];

// 分类方向
function classifyDirection(title: string, company: string): string {
  const text = (title + ' ' + company).toLowerCase();
  
  if (/\b(quant|quantitative|trader|trading|algorithmic)\b/.test(text)) return 'Quant';
  if (/\b(data scientist|data engineer|data analyst|analytics)\b/.test(text)) return 'Data';
  if (/\b(machine learning|mle|ml engineer|deep learning|ai engineer)\b/.test(text)) return 'ML/AI';
  if (/\b(swe|software|engineer|developer|backend|frontend|fullstack|full.?stack|frontend|backend)\b/.test(text)) return 'SDE';
  if (/\b(product manager|pm|program manager)\b/.test(text)) return 'PM';
  if (/\b(risk|fraud|compliance|regulatory)\b/.test(text)) return 'Risk';
  if (/\b(intern|internship|trainee)\b/.test(text)) return 'Intern';
  
  return 'Finance';
}

// 判断是否为金融相关
function isFinanceRelated(title: string, company: string, category: string): boolean {
  const text = (title + ' ' + company + ' ' + category).toLowerCase();
  
  // 匹配金融公司
  for (const c of FINANCE_COMPANIES) {
    if (text.includes(c)) return true;
  }
  
  // 匹配金融关键词
  for (const kw of FINANCE_KEYWORDS) {
    if (text.includes(kw)) return true;
  }
  
  // 匹配金融分类
  const financeCategories = [
    'finance', 'fintech', 'banking', 'cryptocurrency', 'crypto',
    'trading', 'investment', 'accounting'
  ];
  for (const cat of financeCategories) {
    if (category && category.toLowerCase().includes(cat)) return true;
  }
  
  return false;
}

// 提取地区
function extractRegion(url: string, candidateLocations: string[]): string {
  const usLocations = [
    { pattern: /new[\s-]?york|nyc|ny\b/i, region: 'New York, NY' },
    { pattern: /san[\s-]?francisco|sf\b|silicon valley/i, region: 'San Francisco, CA' },
    { pattern: /boston/i, region: 'Boston, MA' },
    { pattern: /chicago/i, region: 'Chicago, IL' },
    { pattern: /seattle/i, region: 'Seattle, WA' },
    { pattern: /austin/i, region: 'Austin, TX' },
    { pattern: /dallas/i, region: 'Dallas, TX' },
    { pattern: /los[\s-]?angeles|la\b/i, region: 'Los Angeles, CA' },
    { pattern: /charlotte/i, region: 'Charlotte, NC' },
    { pattern: /jersey[\s-]?city/i, region: 'Jersey City, NJ' },
    { pattern: /denver|colorado/i, region: 'Denver, CO' },
    { pattern: /atlanta|georgia/i, region: 'Atlanta, GA' },
    { pattern: /miami|florida/i, region: 'Miami, FL' },
  ];
  
  for (const loc of candidateLocations) {
    for (const { pattern, region } of usLocations) {
      if (pattern.test(loc)) return region;
    }
  }
  
  return 'Remote - United States';
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

    // 从 Remotive API 获取数据
    const searchQueries = [
      'finance',
      'fintech',
      'trading',
      'quantitative',
      'software engineer finance',
      'data scientist fintech',
      'blockchain',
    ];

    for (const query of searchQueries) {
      try {
        const response = await fetch(`${REMOTIVE_API}?category=software-development&search=${encodeURIComponent(query)}&limit=100`);
        
        if (!response.ok) {
          console.error(`Remotive API error: ${response.status}`);
          continue;
        }

        const data = await response.json();
        
        if (data.jobs && Array.isArray(data.jobs)) {
          for (const job of data.jobs) {
            const url = job.url;
            const title = job.title;
            const company = job.company_name;
            const description = job.description || '';
            const category = job.category || '';
            const candidateLocations = job.candidate_required_location ? job.candidate_required_location.split(',').map((s: string) => s.trim()) : [];
            
            if (!url || !title || !company) continue;
            
            // 检查是否已存在
            if (seenUrls.has(url)) {
              results.skipped++;
              continue;
            }
            
            // 检查是否为金融相关
            if (!isFinanceRelated(title, company, category) && !description.toLowerCase().includes('finance')) {
              results.skipped++;
              continue;
            }
            
            seenUrls.add(url);
            results.total++;
            
            // 提取地区
            const region = extractRegion(url, candidateLocations);
            
            // 生成描述
            const cleanDescription = description
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .substring(0, 3000);
            
            // 插入数据库
            const { error: insertError } = await supabase
              .from('jobs')
              .insert({
                title: title.substring(0, 200),
                company,
                region,
                direction: classifyDirection(title, company),
                job_url: url,
                description: cleanDescription || title,
                overview: `${title} at ${company}. Remote position.`,
                responsibilities: '',
                requirements: '',
                job_type: job.job_type?.includes('intern') ? '实习' : '社招',
                audience: '留学生',
                is_active: true,
              });

            if (!insertError) {
              results.success++;
              if (results.success <= 20) {
                results.details.push(`[${company}] ${title.substring(0, 50)}`);
              }
            } else {
              results.failed++;
            }
          }
        }
      } catch (error) {
        console.error(`Error fetching ${query}:`, error);
        results.failed++;
      }
      
      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return NextResponse.json({
      message: 'Remotive 岗位同步完成',
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
