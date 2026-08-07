import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { hasValidAdminSession } from '@/lib/admin-auth';
import { detectSponsorship } from '@/lib/utils';

export async function POST(request: NextRequest) {
  try {
    if (!hasValidAdminSession(request)) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 401 });
    }

    // 从环境变量获取 Techmap API Key
    const apiKey = process.env.TECHMAP_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ 
        error: '未配置 Techmap API Key',
        hint: '请在环境变量中设置 TECHMAP_API_KEY'
      }, { status: 500 });
    }

    const supabase = getSupabaseClient();
    const results = {
      total: 0,
      added: 0,
      skipped: 0,
      errors: 0,
    };

    // 定义要搜索的金融岗位关键词
    const searchQueries = [
      { keyword: 'quantitative developer', region: 'US' },
      { keyword: 'algorithmic trading', region: 'US' },
      { keyword: 'software engineer finance', region: 'US' },
      { keyword: 'quant analyst', region: 'US' },
      { keyword: 'trading developer', region: 'US' },
      { keyword: 'investment banking technology', region: 'US' },
      { keyword: 'fintech engineer', region: 'US' },
      { keyword: 'quantitative developer', region: 'UK' },
      { keyword: 'software engineer investment', region: 'UK' },
      { keyword: 'trading technology', region: 'UK' },
    ];

    // 使用 Techmap Job Posting API
    for (const query of searchQueries) {
      try {
        const response = await fetch(
          `https://api.techmap.io/v1/jobs?keyword=${encodeURIComponent(query.keyword)}&location=${query.region}&limit=50`,
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (!response.ok) {
          console.error(`Techmap API error: ${response.status}`);
          continue;
        }

        const data = await response.json();
        
        if (data.jobs && Array.isArray(data.jobs)) {
          for (const job of data.jobs) {
            results.total++;
            
            // 检查是否已存在
            const { data: existing } = await supabase
              .from('jobs')
              .select('id')
              .eq('job_url', job.url || job.link)
              .single();

            if (existing) {
              results.skipped++;
              continue;
            }

            // 提取描述
            const description = job.description || job.content || '';
            const plainText = description.replace(/<[^>]+>/g, ' ').trim();
            
            // 检测 sponsorship
            const sponsorship = detectSponsorship(plainText);
            
            // 分类方向
            const direction = classifyFinanceDirection(job.title || '', description);
            const region = query.region === 'US' ? 'United States' : 'United Kingdom';
            const job_type = detectJobType(job.title || '', description);
            const audience = job_type === '实习' ? '实习' : '全职';

            // 提取薪资（如果有）
            const salary_range = extractSalary(description);

            const { error: insertError } = await supabase
              .from('jobs')
              .insert({
                title: (job.title || 'Unknown Position').substring(0, 200),
                company: job.company || job.employer || 'Unknown Company',
                region,
                direction,
                job_type,
                job_url: job.url || job.link,
                description: plainText.substring(0, 2000),
                requirements: extractRequirements(plainText),
                salary_range,
                audience,
                is_active: true,
                is_closed: false,
                sponsorship,
                source_url: job.source_url || 'eFinancialCareers',
                last_verified_at: new Date().toISOString(),
              });

            if (insertError) {
              console.error('Insert error:', insertError);
              results.errors++;
            } else {
              results.added++;
            }
          }
        }
      } catch (error) {
        console.error(`Error fetching ${query.keyword}:`, error);
        results.errors++;
      }

      // 避免 API 限流
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return NextResponse.json({
      success: true,
      message: `Techmap 同步完成：新增 ${results.added} 个岗位`,
      ...results,
    });
  } catch (error) {
    console.error('Techmap sync error:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// 分类金融方向
function classifyFinanceDirection(title: string, description: string): string {
  const text = (title + ' ' + description).toLowerCase();
  
  if (text.includes('quant') || text.includes('trading') || text.includes('algorithmic')) {
    return 'Quant';
  }
  if (text.includes('risk') || text.includes('risk management')) {
    return 'Risk';
  }
  if (text.includes('software') || text.includes('developer') || text.includes('engineer')) {
    return 'Tech/SDE';
  }
  if (text.includes('data') || text.includes('analytics')) {
    return 'Data';
  }
  if (text.includes('investment') || text.includes('banking') || text.includes('ibd')) {
    return 'IBD/S&T';
  }
  if (text.includes('consulting') || text.includes('strategy')) {
    return 'Consulting';
  }
  if (text.includes('machine learning') || text.includes('ml') || text.includes('ai')) {
    return 'ML/AI';
  }
  
  return 'Finance';
}

// 检测岗位类型
function detectJobType(title: string, description: string): string {
  const text = (title + ' ' + description).toLowerCase();
  
  if (text.includes('intern') || text.includes('internship')) {
    return '实习';
  }
  if (text.includes('graduate') || text.includes('new grad') || text.includes('entry level')) {
    return '校招';
  }
  
  return '社招';
}

// 提取薪资
function extractSalary(text: string): string | null {
  const patterns = [
    /\$[\d,]+k?\s*-\s*\$[\d,]+k?/gi,
    /£[\d,]+k?\s*-\s*£[\d,]+k?/gi,
    /[\d,]+k\s*-\s*[\d,]+k/gi,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }
  
  return null;
}

// 提取要求
function extractRequirements(text: string): string {
  const lines = text.split('\n').filter(line => {
    const lower = line.toLowerCase();
    return lower.includes('require') || lower.includes('prefer') || 
           lower.includes('bachelor') || lower.includes('master') ||
           lower.includes('year') || lower.includes('experience');
  });
  
  return lines.slice(0, 5).join('\n').substring(0, 1000);
}
