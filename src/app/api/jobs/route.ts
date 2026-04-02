import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    
    const region = searchParams.get('region');
    const direction = searchParams.get('direction');
    const audience = searchParams.get('audience');

    let query = client
      .from('jobs')
      .select('*')
      .order('created_at', { ascending: false });

    if (region && region !== '全部') {
      query = query.eq('region', region);
    }
    if (direction && direction !== '全部') {
      query = query.eq('direction', direction);
    }
    if (audience && audience !== '全部') {
      query = query.eq('audience', audience);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`查询岗位失败: ${error.message}`);
    }

    return NextResponse.json({ jobs: data });
  } catch (error) {
    console.error('Error fetching jobs:', error);
    return NextResponse.json(
      { error: '获取岗位列表失败' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const body = await request.json();

    const { data, error } = await client
      .from('jobs')
      .insert(body)
      .select()
      .single();

    if (error) {
      throw new Error(`创建岗位失败: ${error.message}`);
    }

    return NextResponse.json({ job: data });
  } catch (error) {
    console.error('Error creating job:', error);
    return NextResponse.json(
      { error: '创建岗位失败' },
      { status: 500 }
    );
  }
}
