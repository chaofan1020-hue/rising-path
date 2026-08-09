import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { hasValidAdminSession } from '@/lib/admin-auth';

// 验证 URL
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// 验证岗位标题
function isValidTitle(title: string): boolean {
  if (!title || title.length < 5) return false;
  if (title.length > 200) return false;
  return true;
}

export async function GET(request: NextRequest) {
  try {
    if (!hasValidAdminSession(request)) return unauthorizedResponse('需要管理员权限');
    const supabase = getSupabaseClient();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';

    const { data, error } = await supabase
      .from('job_submissions')
      .select('*')
      .eq('status', status)
      .order('submitted_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: '获取失败' }, { status: 500 });
    }

    return NextResponse.json({ submissions: data });
  } catch (error) {
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const supabase = auth.client;
    const body = await request.json();

    const { title, company, region, direction, job_url, description, job_type, salary_range, contact_info } = body;

    // 验证必填字段
    if (!isValidTitle(title)) {
      return NextResponse.json({ error: '请提供有效的岗位标题' }, { status: 400 });
    }

    if (!isValidTitle(company)) {
      return NextResponse.json({ error: '请提供有效的公司名称' }, { status: 400 });
    }

    // 验证 URL
    if (job_url && !isValidUrl(job_url)) {
      return NextResponse.json({ error: '请提供有效的岗位链接' }, { status: 400 });
    }

    // 检查是否重复提交
    if (job_url) {
      const { data: existing } = await supabase
        .from('job_submissions')
        .select('id')
        .eq('job_url', job_url)
        .eq('status', 'pending')
        .single();
      
      if (existing) {
        return NextResponse.json({ error: '该岗位已在待审核列表中' }, { status: 400 });
      }
    }

    // 检查公司 + 标题是否重复
    const { data: duplicate } = await supabase
      .from('job_submissions')
      .select('id')
      .eq('company', company)
      .eq('title', title)
      .eq('status', 'pending')
      .single();

    if (duplicate) {
      return NextResponse.json({ error: '该公司已有相同岗位在审核中' }, { status: 400 });
    }

    // 插入提交
    const { error: insertError } = await supabase
      .from('job_submissions')
      .insert({
        title,
        company,
        region: region || 'United States',
        direction: direction || 'Other',
        job_url: job_url || null,
        description: description || null,
        job_type: job_type || '社招',
        salary_range: salary_range || null,
        contact_info: contact_info || null,
        submitter_info: {
          user_agent: request.headers.get('user-agent') || 'unknown',
        },
        user_id: auth.user.id,
        status: 'pending',
      });

    if (insertError) {
      return NextResponse.json({ error: '提交失败，请重试' }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      message: '岗位已提交，感谢你的贡献！我们会在 24 小时内审核。' 
    });
  } catch (error) {
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
