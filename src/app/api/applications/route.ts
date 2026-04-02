import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET() {
  try {
    const client = getSupabaseClient();
    
    // Get applications with job and resume info
    const { data, error } = await client
      .from('applications')
      .select(`
        *,
        jobs (title, company, region, direction),
        resumes (file_name)
      `)
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

    const { data, error } = await client
      .from('applications')
      .insert(body)
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
