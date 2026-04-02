import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { searchParams } = new URL(request.url);
    const accessCodeId = searchParams.get('access_code_id');
    
    // 必须提供 access_code_id，否则返回空列表
    if (!accessCodeId) {
      return NextResponse.json({ applications: [] });
    }

    // Get applications with job and resume info
    const { data, error } = await client
      .from('applications')
      .select(`
        *,
        jobs (title, company, region, direction),
        resumes (file_name)
      `)
      .eq('access_code_id', parseInt(accessCodeId))
      .order('created_at', { ascending: false });

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
