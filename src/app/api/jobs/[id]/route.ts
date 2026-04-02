import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = getSupabaseClient();
    const { id } = await params;

    const { data, error } = await client
      .from('jobs')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      return NextResponse.json(
        { error: '岗位不存在' },
        { status: 404 }
      );
    }

    return NextResponse.json({ job: data });
  } catch (error) {
    console.error('Error fetching job:', error);
    return NextResponse.json(
      { error: '获取岗位详情失败' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = getSupabaseClient();
    const { id } = await params;
    const body = await request.json();

    const { data, error } = await client
      .from('jobs')
      .update({
        ...body,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`更新岗位失败: ${error.message}`);
    }

    return NextResponse.json({ job: data });
  } catch (error) {
    console.error('Error updating job:', error);
    return NextResponse.json(
      { error: '更新岗位失败' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = getSupabaseClient();
    const { id } = await params;

    // 先删除关联的 ai_matches 记录
    await client
      .from('ai_matches')
      .delete()
      .eq('job_id', id);

    // 先删除关联的 applications 记录
    await client
      .from('applications')
      .delete()
      .eq('job_id', id);

    // 先删除关联的 application_fields 记录
    await client
      .from('application_fields')
      .delete()
      .eq('job_id', id);

    // 最后删除岗位
    const { error } = await client
      .from('jobs')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`删除岗位失败: ${error.message}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting job:', error);
    return NextResponse.json(
      { error: '删除岗位失败' },
      { status: 500 }
    );
  }
}
