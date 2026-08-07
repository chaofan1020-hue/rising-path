import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { hasValidAdminSession } from '@/lib/admin-auth';

export async function PATCH(request: NextRequest) {
  try {
    if (!hasValidAdminSession(request)) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 401 });
    }

    const supabase = getSupabaseClient();
    const body = await request.json();
    const { id, action, notes } = body;

    if (!id || !action) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    // 更新状态
    const { error: updateError } = await supabase
      .from('job_submissions')
      .update({
        status: newStatus,
        reviewed_at: new Date().toISOString(),
        notes: notes || null,
      })
      .eq('id', id);

    if (updateError) {
      return NextResponse.json({ error: '更新失败' }, { status: 500 });
    }

    // 如果是批准，同时添加到正式岗位表
    if (action === 'approve') {
      const { data: submission } = await supabase
        .from('job_submissions')
        .select('*')
        .eq('id', id)
        .single();

      if (submission) {
        await supabase.from('jobs').insert({
          title: submission.title,
          company: submission.company,
          region: submission.region,
          direction: submission.direction,
          job_type: submission.job_type,
          job_url: submission.job_url,
          description: submission.description,
          salary_range: submission.salary_range,
          audience: '留学生',
          is_active: true,
        });
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: action === 'approve' ? '已批准并添加到岗位列表' : '已拒绝' 
    });
  } catch (error) {
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!hasValidAdminSession(request)) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 401 });
    }

    const supabase = getSupabaseClient();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const { error: deleteError } = await supabase
      .from('job_submissions')
      .delete()
      .eq('id', id);

    if (deleteError) {
      return NextResponse.json({ error: '删除失败' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
