import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 地区映射：将具体地区映射到所属大地区
const regionMapping: Record<string, string> = {
  // 美国主要城市
  'San Francisco, CA': '美国',
  'Seattle, WA': '美国',
  'New York, NY': '美国',
  'Los Angeles, CA': '美国',
  'Austin, TX': '美国',
  'Boston, MA': '美国',
  'Chicago, IL': '美国',
  'Denver, CO': '美国',
  'Atlanta, GA': '美国',
  'Remote - United States': '美国',
  'United States': '美国',
  // 英国
  'London, UK': '英国',
  'United Kingdom': '英国',
  // 加拿大
  'Toronto, ON': '加拿大',
  'Vancouver, BC': '加拿大',
  'Canada': '加拿大',
  // 澳大利亚
  'Sydney, NSW': '澳大利亚',
  'Melbourne, VIC': '澳大利亚',
  'Australia': '澳大利亚',
  // 新加坡
  'Singapore': '新加坡',
  // 香港
  'Hong Kong': '香港',
  // 日本
  'Tokyo, Japan': '日本',
  'Japan': '日本',
  // 欧洲
  'Germany': '德国',
  'France': '法国',
  'Europe': '欧洲',
};

// 获取岗位所属的大地区
function getRegionCategory(region: string): string {
  return regionMapping[region] || region;
}

// 判断岗位是否匹配选中的地区（支持包含关系）
function isRegionMatch(jobRegion: string, selectedRegions: string[]): boolean {
  if (selectedRegions.length === 0) return true;
  
  for (const selected of selectedRegions) {
    const jobCategory = getRegionCategory(jobRegion);
    // 如果选中的地区等于岗位的地区分类
    if (jobCategory === selected) return true;
    // 如果选中的地区等于岗位的完整地区
    if (jobRegion === selected) return true;
  }
  return false;
}

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

    // 地区筛选（在应用层处理，支持包含关系）
    let filteredJobs = data;
    if (regions.length > 0) {
      filteredJobs = data.filter((job: { region: string }) => isRegionMatch(job.region, regions));
    }

    // 为每个岗位添加地区分类
    const jobsWithCategory = filteredJobs.map((job: { region: string; [key: string]: unknown }) => ({
      ...job,
      region_category: getRegionCategory(job.region)
    }));

    return NextResponse.json({ jobs: jobsWithCategory });
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
