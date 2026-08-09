import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 获取可用于模拟面试的公司/岗位列表（公共数据，无需鉴权严格校验）
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const { searchParams } = new URL(request.url);
    const company = searchParams.get('company');

    const client = auth.client;

    if (company) {
      // 按公司筛选岗位
      const { data, error } = await client
        .from('jobs')
        .select('id, title, company, direction, region, description, requirements')
        .eq('company', company)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return NextResponse.json({ jobs: data || [] });
    }

    // 聚合公司列表
    const { data, error } = await client
      .from('jobs')
      .select('company')
      .order('company');

    if (error) throw error;

    const companies = Array.from(
      new Set((data || []).map((j: { company: string }) => j.company).filter(Boolean))
    );

    return NextResponse.json({ companies });
  } catch (error) {
    console.error('Interview jobs error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取岗位失败' },
      { status: 500 }
    );
  }
}
