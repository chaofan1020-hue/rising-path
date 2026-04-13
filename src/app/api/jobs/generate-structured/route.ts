import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

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
    /about the job[:\s]*(.+?)(?=qualifications|requirements|skills|$)/is,
  ];
  
  let responsibilities = '';
  for (const pattern of respPatterns) {
    const match = text.match(pattern);
    if (match) {
      const bulletPoints = match[1]
        .split(/[-•·▪▸·*]\s*/)
        .filter((s) => s.trim().length > 20 && s.trim().length < 200)
        .slice(0, 5)
        .map((s) => s.trim().replace(/<[^>]+>/g, '').replace(/\*\*/g, ''))
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
    /who you are[:\s]*(.+?)(?=nice to have|bonus|preferred|$)/is,
  ];
  
  let requirements = '';
  for (const pattern of reqPatterns) {
    const match = text.match(pattern);
    if (match) {
      const bulletPoints = match[1]
        .split(/[-•·▪▸·*]\s*/)
        .filter((s) => s.trim().length > 10 && s.trim().length < 200)
        .slice(0, 5)
        .map((s) => s.trim().replace(/<[^>]+>/g, '').replace(/\*\*/g, ''))
        .join('|');
      if (bulletPoints) {
        requirements = bulletPoints;
        break;
      }
    }
  }
  
  // 提取加分项
  const nicePatterns = [
    /nice to have[:\s]*(.+?)(?=\*\*|$)/is,
    /bonus[:\s]*(.+?)(?=\*\*|$)/is,
    /preferred[:\s]*(.+?)(?=\*\*|$)/is,
  ];
  
  let nice_to_have = '';
  for (const pattern of nicePatterns) {
    const match = text.match(pattern);
    if (match) {
      const bulletPoints = match[1]
        .split(/[-•·▪▸·*]\s*/)
        .filter((s) => s.trim().length > 10 && s.trim().length < 200)
        .slice(0, 3)
        .map((s) => s.trim().replace(/<[^>]+>/g, '').replace(/\*\*/g, ''))
        .join('|');
      if (bulletPoints) {
        nice_to_have = bulletPoints;
        break;
      }
    }
  }
  
  return { overview, responsibilities, requirements, nice_to_have };
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

    // 获取所有需要处理的岗位
    const { data: jobs, error } = await supabase
      .from('jobs')
      .select('id, title, company, description')
      .or('overview.is.null,overview.eq.')
      .eq('is_active', true)
      .limit(50);

    if (error) {
      return NextResponse.json({ error: '获取岗位失败' }, { status: 500 });
    }

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({ message: '没有需要处理的岗位', processed: 0 });
    }

    let processed = 0;
    let updated = 0;

    for (const job of jobs) {
      if (!job.description || job.description.length < 50) continue;
      
      processed++;
      
      // 解析描述
      const parsed = parseJobDescription(job.description, job.title, job.company);
      
      // 如果有解析出有效内容，更新数据库
      if (parsed.overview || parsed.responsibilities || parsed.requirements) {
        const { error: updateError } = await supabase
          .from('jobs')
          .update({
            overview: parsed.overview,
            responsibilities: parsed.responsibilities,
            requirements: parsed.requirements,
            nice_to_have: parsed.nice_to_have,
          })
          .eq('id', job.id);

        if (!updateError) {
          updated++;
        }
      }
      
      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return NextResponse.json({
      message: '岗位描述解析完成',
      processed,
      updated,
    });
  } catch (error) {
    console.error('Parse error:', error);
    return NextResponse.json(
      { error: '解析失败', details: String(error) },
      { status: 500 }
    );
  }
}
