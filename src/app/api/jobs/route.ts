import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    
    // 获取多选参数（地区和方向支持多选）
    const regions = searchParams.getAll('region');
    const directions = searchParams.getAll('direction');
    const audience = searchParams.get('audience');
    const limit = searchParams.get('limit');

    let query = client
      .from('jobs')
      .select('*')
      .order('created_at', { ascending: false });

    // 只获取活跃的岗位
    query = query.eq('is_active', true);

    // 地区多选筛选
    if (regions.length > 0) {
      query = query.in('region', regions);
    }
    // 方向多选筛选
    if (directions.length > 0) {
      query = query.in('direction', directions);
    }
    // 受众单选筛选
    if (audience && audience !== '全部') {
      query = query.eq('audience', audience);
    }

    // 限制返回数量（用于自动同步检查）
    if (limit) {
      query = query.limit(parseInt(limit));
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
