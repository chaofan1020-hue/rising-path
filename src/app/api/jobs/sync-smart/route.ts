import { NextRequest, NextResponse } from 'next/server';
import { FetchClient, SearchClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 岗位方向分类
function classifyDirection(title: string): string {
  const text = title.toLowerCase();
  if (/\b(quant|quantitative|trader|trading|alg|algo)\b/.test(text)) return 'Quant';
  if (/\b(data scientist|data engineer|analytics|machine learning|ml|mle)\b/.test(text)) return 'Data';
  if (/\b(swe|software|engineer|developer|backend|frontend|full.?stack)\b/.test(text)) return 'SDE';
  if (/\b(intern|summer)\b/.test(text)) return 'Intern';
  if (/\b(product manager|pm|program manager)\b/.test(text)) return 'PM';
  if (/\b(risk|fraud|compliance)\b/.test(text)) return 'Risk';
  return 'Finance';
}

// 提取地区
function extractRegion(title: string, location: string): string {
  const text = (title + ' ' + location).toLowerCase();
  
  const regions: Array<[string[], string]> = [
    [['new york', 'nyc', 'ny', 'manhattan'], 'New York, NY'],
    [['san francisco', 'sf', 'silicon valley'], 'San Francisco, CA'],
    [['jersey city', 'jerseycity'], 'Jersey City, NJ'],
    [['hoboken'], 'Hoboken, NJ'],
    [['greenwich'], 'Greenwich, CT'],
    [['boston'], 'Boston, MA'],
    [['chicago'], 'Chicago, IL'],
    [['seattle'], 'Seattle, WA'],
    [['austin'], 'Austin, TX'],
    [['dallas'], 'Dallas, TX'],
    [['charlotte'], 'Charlotte, NC'],
    [['los angeles', 'la'], 'Los Angeles, CA'],
    [['mountain view', 'palo alto', 'menlo park'], 'Silicon Valley, CA'],
    [['remote'], 'Remote - United States'],
    [['london'], 'London, UK'],
    [['hong kong'], 'Hong Kong'],
    [['singapore'], 'Singapore'],
  ];
  
  for (const [keywords, region] of regions) {
    if (keywords.some(kw => text.includes(kw))) {
      return region;
    }
  }
  
  return 'United States';
}

// 获取岗位类型
function getJobType(title: string): string {
  const text = title.toLowerCase();
  if (/\b(intern|internship|trainee)\b/.test(text)) return '实习';
  if (/\b(junior|entry.?level|new grad)\b/.test(text)) return '校招';
  return '社招';
}

// 验证岗位标题
function isValidTitle(title: string): boolean {
  if (!title || title.length < 5) return false;
  
  // 过滤太通用
  const tooGeneric = ['analyst', 'associate', 'manager', 'director', 'vp '];
  const titleLower = title.toLowerCase();
  if (tooGeneric.some(t => titleLower.trim() === t)) return false;
  
  // 必须有技术/金融关键词
  const hasKeyword = /engineer|developer|analyst|quant|trader|data|scientist|technology|tech|research|model/.test(titleLower);
  return hasKeyword;
}

// 从 Greenhouse API 获取岗位
async function fetchGreenhouseJobs(companyId: string): Promise<Array<{title: string; url: string; location: string; updated_at: string}>> {
  const jobs: Array<{title: string; url: string; location: string; updated_at: string}> = [];
  
  try {
    const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${companyId}/jobs?content=true`);
    if (response.ok) {
      const data = await response.json();
      if (data.jobs) {
        for (const job of data.jobs) {
          jobs.push({
            title: job.title,
            url: job.absolute_url,
            location: job.location?.name || 'United States',
            updated_at: job.updated_at,
          });
        }
      }
    }
  } catch (error) {
    console.error(`Greenhouse fetch error for ${companyId}:`, error);
  }
  
  return jobs;
}

// 从 Lever API 获取岗位
async function fetchLeverJobs(companyId: string): Promise<Array<{title: string; url: string; location: string; updated_at: string}>> {
  const jobs: Array<{title: string; url: string; location: string; updated_at: string}> = [];
  
  try {
    const response = await fetch(`https://api.lever.co/v0/postings/${companyId}?mode=json`);
    if (response.ok) {
      const data = await response.json();
      for (const job of data) {
        jobs.push({
          title: job.text,
          url: job.absolute_url,
          location: job.location || 'United States',
          updated_at: job.postedAt || '',
        });
      }
    }
  } catch (error) {
    console.error(`Lever fetch error for ${companyId}:`, error);
  }
  
  return jobs;
}

// 从 BuiltIn 获取岗位
async function fetchBuiltInJobs(companyId: string): Promise<Array<{title: string; url: string; location: string; updated_at: string}>> {
  const jobs: Array<{title: string; url: string; location: string; updated_at: string}> = [];
  
  try {
    const response = await fetch(`https://api.builtin.com/api/v1/companies/${companyId}/jobs`);
    if (response.ok) {
      const data = await response.json();
      if (data.jobs) {
        for (const job of data.jobs) {
          jobs.push({
            title: job.title,
            url: job.url,
            location: job.location || 'United States',
            updated_at: job.updated_at || '',
          });
        }
      }
    }
  } catch (error) {
    console.error(`BuiltIn fetch error for ${companyId}:`, error);
  }
  
  return jobs;
}

// 从招聘页面抓取岗位
async function fetchFromCareersPage(url: string, company: string): Promise<Array<{title: string; url: string; location: string; updated_at: string}>> {
  const jobs: Array<{title: string; url: string; location: string; updated_at: string}> = [];
  
  try {
    const config = new Config();
    const customHeaders = HeaderUtils.extractForwardHeaders({} as NextRequest.headers);
    const client = new FetchClient(config, customHeaders);
    
    const response = await client.fetch(url);
    
    if (response.status_code === 0 && response.content) {
      const html = response.content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n');
      
      // 匹配 JSON-LD 数据
      const jsonLdMatches = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
      for (const match of jsonLdMatches) {
        try {
          const jsonContent = match.replace(/<script[^>]*type="application\/ld\+json"[^>]*>/i, '').replace(/<\/script>/i, '');
          const data = JSON.parse(jsonContent);
          
          const postings = Array.isArray(data) ? data : [data];
          for (const posting of postings) {
            if (posting['@type'] === 'JobPosting' && posting.title) {
              jobs.push({
                title: posting.title,
                url: posting.url || posting.identifier?.name || url,
                location: posting.jobLocation?.address?.addressRegion || 'United States',
                updated_at: posting.datePosted || '',
              });
            }
          }
        } catch (e) {
          // 忽略 JSON 解析错误
        }
      }
      
      // 匹配职位列表链接
      const linkPattern = /href="([^"]*job[^"]*)"[^>]*>\s*([^<]*?(?:engineer|developer|analyst|quant|trader|data|scientist)[^<]*)/gi;
      let match;
      while ((match = linkPattern.exec(html)) !== null) {
        const jobUrl = match[1];
        const jobTitle = match[2].trim();
        
        if (jobTitle.length > 5 && jobUrl.startsWith('http')) {
          // 检查是否已存在
          if (!jobs.some(j => j.url === jobUrl)) {
            jobs.push({
              title: jobTitle,
              url: jobUrl,
              location: 'United States',
              updated_at: '',
            });
          }
        }
      }
    }
  } catch (error) {
    console.error(`Careers page fetch error for ${url}:`, error);
  }
  
  return jobs;
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
      new_jobs: 0,
      closed_jobs: 0,
      skipped_existing: 0,
      errors: 0,
      details: [] as string[],
      company_stats: {} as Record<string, { found: number; added: number }>,
    };

    // 获取所有活跃的公司配置
    const { data: companies, error: configError } = await supabase
      .from('company_config')
      .select('*')
      .eq('is_active', true);

    if (configError || !companies) {
      return NextResponse.json({ error: '获取公司配置失败' }, { status: 500 });
    }

    // 收集当前活跃的岗位 URL
    const activeJobUrls = new Set<string>();

    // 遍历每个公司
    for (const company of companies) {
      let fetchedJobs: Array<{title: string; url: string; location: string; updated_at: string}> = [];

      try {
        // 根据 ATS 类型获取岗位
        if (company.ats_type === 'greenhouse' && company.ats_id) {
          fetchedJobs = await fetchGreenhouseJobs(company.ats_id);
        } else if (company.ats_type === 'lever' && company.ats_id) {
          fetchedJobs = await fetchLeverJobs(company.ats_id);
        } else if (company.ats_type === 'builtin' && company.ats_id) {
          fetchedJobs = await fetchBuiltInJobs(company.ats_id);
        } else if (company.careers_url) {
          fetchedJobs = await fetchFromCareersPage(company.careers_url, company.company_name);
        }

        results.company_stats[company.company_name] = { found: fetchedJobs.length, added: 0 };

        // 处理每个岗位
        for (const job of fetchedJobs) {
          if (!isValidTitle(job.title)) continue;

          activeJobUrls.add(job.url);

          // 检查是否已存在
          const { data: existing } = await supabase
            .from('jobs')
            .select('id')
            .eq('job_url', job.url)
            .single();

          if (existing) {
            // 更新岗位状态为活跃
            await supabase
              .from('jobs')
              .update({ 
                is_closed: false,
                last_verified_at: new Date().toISOString(),
              })
              .eq('id', existing.id);
            results.skipped_existing++;
          } else {
            // 添加新岗位
            const direction = classifyDirection(job.title);
            const region = extractRegion(job.title, job.location);
            const job_type = getJobType(job.title);

            const { error: insertError } = await supabase
              .from('jobs')
              .insert({
                title: job.title.substring(0, 200),
                company: company.company_name,
                region,
                direction,
                job_type,
                job_url: job.url,
                source_url: company.careers_url,
                description: job.title,
                audience: '留学生',
                is_active: true,
                is_closed: false,
                last_verified_at: new Date().toISOString(),
              });

            if (!insertError) {
              results.new_jobs++;
              results.company_stats[company.company_name].added++;
              results.details.push(`[${company.company_name}] + ${job.title.substring(0, 40)}`);
            } else {
              results.errors++;
            }
          }
        }

        // 更新公司最后同步时间
        await supabase
          .from('company_config')
          .update({ last_synced_at: new Date().toISOString() })
          .eq('id', company.id);

      } catch (error) {
        console.error(`Error processing ${company.company_name}:`, error);
        results.errors++;
      }

      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 标记已关闭的岗位（不在活跃列表中的）
    // 注意：只有来源是公司配置的那些岗位才标记为关闭
    const { data: jobsToCheck } = await supabase
      .from('jobs')
      .select('id, job_url, company, source_url, is_closed')
      .eq('is_active', true);

    if (jobsToCheck) {
      for (const job of jobsToCheck) {
        // 如果岗位 URL 不在活跃列表中，且来源是公司配置
        const companyConfig = companies.find(c => c.company_name === job.company);
        
        if (companyConfig && !activeJobUrls.has(job.job_url) && !job.is_closed) {
          await supabase
            .from('jobs')
            .update({ is_closed: true })
            .eq('id', job.id);
          
          results.closed_jobs++;
          results.details.push(`[${job.company}] - 已关闭: ${job.job_url.substring(0, 40)}`);
        }
      }
    }

    return NextResponse.json({
      message: '智能同步完成',
      ...results,
    });
  } catch (error) {
    console.error('Smart sync error:', error);
    return NextResponse.json(
      { error: '同步失败', details: String(error) },
      { status: 500 }
    );
  }
}
