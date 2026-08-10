import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';

function parsePositiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function readJobId(request: NextRequest): Promise<number | null> {
  try {
    const body = await request.json();
    return parsePositiveId(body?.job_id ?? body?.jobId);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();

    const { data, error } = await auth.client
      .from('favorites')
      .select('id, job_id, created_at, updated_at')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`查询收藏失败: ${error.message}`);
    return NextResponse.json({ favorites: data || [] });
  } catch (error) {
    console.error('Error fetching favorites:', error);
    return NextResponse.json({ error: '获取收藏失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();

    const jobId = await readJobId(request);
    if (!jobId) return NextResponse.json({ error: '岗位 ID 无效' }, { status: 400 });

    const { data: job, error: jobError } = await auth.client
      .from('jobs')
      .select('id')
      .eq('id', jobId)
      .eq('is_active', true)
      .maybeSingle();
    if (jobError) throw new Error(`检查岗位失败: ${jobError.message}`);
    if (!job) return NextResponse.json({ error: '岗位不存在或已下架' }, { status: 404 });

    const { data, error } = await auth.client
      .from('favorites')
      .insert({ job_id: jobId, user_id: auth.user.id })
      .select('id, job_id, created_at, updated_at')
      .single();

    if (error?.code === '23505') {
      const { data: existing, error: existingError } = await auth.client
        .from('favorites')
        .select('id, job_id, created_at, updated_at')
        .eq('job_id', jobId)
        .eq('user_id', auth.user.id)
        .single();
      if (existingError || !existing) throw new Error(`读取已有收藏失败: ${existingError?.message || '未找到收藏'}`);
      return NextResponse.json({ favorite: existing, already_exists: true });
    }
    if (error || !data) throw new Error(`创建收藏失败: ${error?.message || '未返回收藏记录'}`);

    return NextResponse.json({ favorite: data }, { status: 201 });
  } catch (error) {
    console.error('Error creating favorite:', error);
    return NextResponse.json({ error: '收藏岗位失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();

    const jobId = await readJobId(request);
    if (!jobId) return NextResponse.json({ error: '岗位 ID 无效' }, { status: 400 });

    const { error } = await auth.client
      .from('favorites')
      .delete()
      .eq('job_id', jobId)
      .eq('user_id', auth.user.id);
    if (error) throw new Error(`取消收藏失败: ${error.message}`);

    return NextResponse.json({ success: true, job_id: jobId });
  } catch (error) {
    console.error('Error deleting favorite:', error);
    return NextResponse.json({ error: '取消收藏失败' }, { status: 500 });
  }
}
