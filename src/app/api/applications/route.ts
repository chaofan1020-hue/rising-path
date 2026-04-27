import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { searchParams } = new URL(request.url);
    const accessCodeId = searchParams.get('access_code_id');
    const isAdmin = request.headers.get('x-admin-request') === 'true';
    
    let query = client.from('applications').select(`
      *,
      jobs (title, company, region, direction),
      resumes (file_name)
    `);
    
    // 管理员可以查看所有网申记录，普通用户需要 access_code_id
    if (!accessCodeId && !isAdmin) {
      return NextResponse.json({ applications: [] });
    }
    
    if (accessCodeId) {
      query = query.eq('access_code_id', parseInt(accessCodeId));
    }
    
    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      throw new Error(`查询网申记录失败: ${error.message}`);
    }

    return NextResponse.json({ applications: data });
  } catch (error) {
    console.error('Error fetching applications:', error);
    return NextResponse.json(
      { error: '获取网申记录失败' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const body = await request.json();
    
    // 从请求体中提取 access_code_id
    const { access_code_id, ...applicationData } = body;

    // 必须提供 access_code_id
    if (!access_code_id) {
      return NextResponse.json({ error: '未授权的访问' }, { status: 401 });
    }

    const { data, error } = await client
      .from('applications')
      .insert({
        ...applicationData,
        access_code_id: access_code_id,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`创建网申记录失败: ${error.message}`);
    }

    return NextResponse.json({ application: data });
  } catch (error) {
    console.error('Error creating application:', error);
    return NextResponse.json(
      { error: '创建网申记录失败' },
      { status: 500 }
    );
  }
}
