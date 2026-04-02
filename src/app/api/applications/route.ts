import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { searchParams } = new URL(request.url);
    const accessCodeId = searchParams.get('access_code_id');
    
    // Get applications with job and resume info
    let query = client
      .from('applications')
      .select(`
        *,
        jobs (title, company, region, direction),
        resumes (file_name)
      `)
      .order('created_at', { ascending: false });
    
    // 如果有 access_code_id，只返回该用户的网申记录
    if (accessCodeId) {
      query = query.eq('access_code_id', parseInt(accessCodeId));
    }

    const { data, error } = await query;

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

    const { data, error } = await client
      .from('applications')
      .insert({
        ...applicationData,
        access_code_id: access_code_id || null,
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
