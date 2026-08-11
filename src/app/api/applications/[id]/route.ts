import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { isApplicationStatus } from '@/lib/application-status';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { hasValidAdminSession } from '@/lib/admin-auth';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const isAdmin = hasValidAdminSession(request);
    const auth = isAdmin ? null : await getAuthContext(request);
    if (!isAdmin && !auth) return unauthorizedResponse();
    const client = isAdmin ? getSupabaseClient() : auth!.client;
    const { id } = await params;
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: '网申记录 ID 无效' }, { status: 400 });
    const body = await request.json();
    if (body.status !== undefined && !isApplicationStatus(body.status)) {
      return NextResponse.json({ error: '无效的网申状态' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.status !== undefined) {
      updateData.status = body.status;
      if (body.status === 'submitted') {
        updateData.submitted_at = new Date().toISOString();
      }
    }

    if (body.notes !== undefined) {
      updateData.notes = body.notes;
    }

    let query = client
      .from('applications')
      .update(updateData)
      .eq('id', id);
    if (!isAdmin) query = query.eq('user_id', auth!.user.id);

    const { data, error } = await query
      .select(`
        *,
        jobs (title, company),
        resumes (file_name)
      `)
      .single();

    if (error) {
      throw new Error(`更新网申记录失败: ${error.message}`);
    }

    return NextResponse.json({ application: data });
  } catch (error) {
    console.error('Error updating application:', error);
    return NextResponse.json(
      { error: '更新网申记录失败' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const isAdmin = hasValidAdminSession(request);
    const auth = isAdmin ? null : await getAuthContext(request);
    if (!isAdmin && !auth) return unauthorizedResponse();
    const client = isAdmin ? getSupabaseClient() : auth!.client;
    const { id } = await params;
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: '网申记录 ID 无效' }, { status: 400 });

    let query = client
      .from('applications')
      .delete()
      .eq('id', id);
    if (!isAdmin) query = query.eq('user_id', auth!.user.id);
    const { error } = await query;

    if (error) {
      throw new Error(`删除网申记录失败: ${error.message}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting application:', error);
    return NextResponse.json(
      { error: '删除网申记录失败' },
      { status: 500 }
    );
  }
}
