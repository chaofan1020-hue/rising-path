import { NextRequest, NextResponse } from 'next/server';
import { FetchClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 金融公司招聘页面 URL（直接从官网获取）
const CAREERS_PAGES: Record<string, string[]> = {
  'Goldman Sachs': [
    'https://www.goldmansachs.com/careers/jobs?page=1&limit=20',
  ],
  'Morgan Stanley': [
    'https://www.morganstanley.com/careers/search-jobs?page=1',
  ],
  'JPMorgan': [
    'https://careers.jpmorgan.com/us/en/search-results?keywords=technology',
  ],
  'BlackRock': [
    'https://www.blackrock.com/careers/search-jobs',
  ],
  'Citadel': [
    'https://www.citadel.com/careers/open-positions/',
  ],
  'Two Sigma': [
    'https://www.twosigma.com/careers/',
  ],
  'Jane Street': [
    'https://www.janestreet.com/join/jobs/',
  ],
  'Barclays': [
    'https://home.barclays/careers/search-jobs/',
  ],
  'Deutsche Bank': [
    'https://www.db.com/careers/en/grad.html',
  ],
  'Bank of America': [
    'https://careers.bankofamerica.com/en-us/search?keywords=technology',
  ],
  'Citi': [
    'https://jobs.citi.com/search-jobs?keyword=technology',
  ],
  'UBS': [
    'https://www.ubs.com/global/en/careers.html',
  ],
  'Vanguard': [
    'https://investor.vanguard.com/careers',
  ],
  'Fidelity': [
    'https://jobs.fidelity.com/search-jobs/',
  ],
  'PIMCO': [
    'https://www.pimco.com/about-us/careers',
  ],
  'DE Shaw': [
    'https://www.deshaw.com/careers',
  ],
};

// 提取岗位信息
function extractJobsFromPage(html: string, company: string): Array<{title: string; url: string; region: string}> {
  const jobs: Array<{title: string; url: string; region: string}> = [];
  
  // 匹配 JSON-LD 结构化数据
  const jsonLdMatches = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const match of jsonLdMatches) {
    try {
      const jsonContent = match.replace(/<script[^>]*type="application\/ld\+json"[^>]*>/i, '').replace(/<\/script>/i, '');
      const data = JSON.parse(jsonContent);
      
      if (data['@type'] === 'JobPosting' || (Array.isArray(data) && data.some(d => d['@type'] === 'JobPosting'))) {
        const postings = Array.isArray(data) ? data.filter(d => d['@type'] === 'JobPosting') : [data];
        for (const posting of postings) {
          if (posting.title && posting.url) {
            jobs.push({
              title: posting.title,
              url: posting.url,
              region: posting.jobLocation?.address?.addressRegion || 'United States',
            });
          }
        }
      }
    } catch (e) {
      // 忽略 JSON 解析错误
    }
  }
  
  // 匹配 HTML 列表
  const linkPattern = /href="([^"]*careers?[^"]*(?:jobs?|positions?|openings?)[^"]*)"[^>]*>\s*([^<]*(?:engineer|developer|analyst|quant|trader|swe|software|data|science|tech|technology)[^<]*)/gi;
  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    const url = match[1];
    const title = match[2].trim();
    
    if (title.length > 5 && url.startsWith('http')) {
      jobs.push({
        title,
        url,
        region: 'United States',
      });
    }
  }
  
  return jobs;
}

// 验证岗位
function isValidJob(title: string, url: string): boolean {
  if (!title || title.length < 10) return false;
  
  const titleLower = title.toLowerCase();
  
  // 过滤中文和非英语
  if (/[\u4e00-\u9fa5]/.test(title)) return false;
  
  // 必须是技术/金融相关
  const keywords = ['engineer', 'developer', 'analyst', 'quant', 'trader', 'swe', 'software', 'data', 'science', 'tech', 'technology', 'research', 'model'];
  if (!keywords.some(kw => titleLower.includes(kw))) return false;
  
  return true;
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
    const client = new FetchClient(config, customHeaders);

    const results = {
      success: 0,
      skipped: 0,
      failed: 0,
      total: 0,
      details: [] as string[],
    };

    const seenUrls = new Set<string>();

    // 获取现有岗位 URL
    const { data: existingJobs } = await supabase
      .from('jobs')
      .select('job_url');

    if (existingJobs) {
      for (const job of existingJobs) {
        if (job.job_url) seenUrls.add(job.job_url);
      }
    }

    // 从每个公司的招聘页面获取岗位
    for (const [company, urls] of Object.entries(CAREERS_PAGES)) {
      for (const careersUrl of urls) {
        try {
          const response = await client.fetch(careersUrl);
          
          if (response.status_code === 0 && response.content) {
            const htmlContent = response.content
              .filter(item => item.type === 'text')
              .map(item => item.text)
              .join('\n');

            const jobs = extractJobsFromPage(htmlContent, company);
            
            for (const job of jobs) {
              if (!isValidJob(job.title, job.url)) continue;
              if (seenUrls.has(job.url)) {
                results.skipped++;
                continue;
              }
              
              seenUrls.add(job.url);
              results.total++;
              
              // 插入数据库
              const { error: insertError } = await supabase
                .from('jobs')
                .insert({
                  title: job.title.substring(0, 200),
                  company,
                  region: job.region,
                  direction: job.titleLower?.includes('quant') ? 'Quant' : 'SDE',
                  job_url: job.url,
                  description: job.title,
                  audience: '留学生',
                  is_active: true,
                });

              if (!insertError) {
                results.success++;
                results.details.push(`[新增] ${company}: ${job.title.substring(0, 60)}`);
              } else {
                results.failed++;
              }
              
              // 避免过快
              await new Promise(resolve => setTimeout(resolve, 200));
            }
          }
        } catch (error) {
          console.error(`Error fetching ${company}:`, error);
          results.failed++;
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return NextResponse.json({
      message: '官网招聘页面抓取完成',
      ...results,
    });
  } catch (error) {
    console.error('Scrape error:', error);
    return NextResponse.json(
      { error: '抓取失败', details: String(error) },
      { status: 500 }
    );
  }
}
