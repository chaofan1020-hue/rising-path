import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { isApplicationStatus } from '@/lib/application-status';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { hasValidAdminSession } from '@/lib/admin-auth';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const isAdminRequest = hasValidAdminSession(request);
  if (isAdminRequest) {
    const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.configWrite);
    if (permissionError) return permissionError;
  }
  try {
    const isAdmin = isAdminRequest;
    const auth = isAdmin ? null : await getAuthContext(request);
    if (!isAdmin && !auth) return unauthorizedResponse();
    const client = isAdmin ? getSupabaseClient() : auth!.client;
    const { id } = await params;
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: '网申记录 ID 无效' }, { status: 400 });
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
    }
    const payload = body as Record<string, unknown>;
    if (payload.status !== undefined && !isApplicationStatus(payload.status)) {
      return NextResponse.json({ error: '无效的网申状态' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (payload.status !== undefined) {
      updateData.status = payload.status;
      if (payload.status === 'submitted') {
        updateData.submitted_at = new Date().toISOString();
      }
    }

    if (payload.notes !== undefined) {
      if (typeof payload.notes !== 'string' || payload.notes.length > 5_000) {
        return NextResponse.json({ error: '备注必须为不超过 5000 字的文本' }, { status: 400 });
      }
      updateData.notes = payload.notes;
    }

    let beforeData: Record<string, unknown> | null = null;
    if (isAdmin) {
      const { data: existing } = await client.from('applications').select('*').eq('id', id).maybeSingle();
      beforeData = existing as Record<string, unknown> | null;
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
      .maybeSingle();

    if (error) {
      throw new Error(`更新网申记录失败: ${error.message}`);
    }
    if (!data) return NextResponse.json({ error: '网申记录不存在' }, { status: 404 });

    if (isAdmin) {
      await recordAdminAuditEvent({
        request,
        action: 'application.update',
        resourceType: 'application',
        resourceId: id,
        subjectUserId: typeof data?.user_id === 'string' ? data.user_id : null,
        beforeData,
        afterData: data,
      });
    }

    return NextResponse.json({ application: data });
  } catch (error) {
    console.error('Error updating application:', error);
    if (isAdminRequest) {
      await recordAdminAuditFailure({ request, action: 'application.update', resourceType: 'application', error });
    }
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
  const isAdminRequest = hasValidAdminSession(request);
  if (isAdminRequest) {
    const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.configWrite);
    if (permissionError) return permissionError;
  }
  try {
    const isAdmin = isAdminRequest;
    const auth = isAdmin ? null : await getAuthContext(request);
    if (!isAdmin && !auth) return unauthorizedResponse();
    const client = isAdmin ? getSupabaseClient() : auth!.client;
    const { id } = await params;
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: '网申记录 ID 无效' }, { status: 400 });

    let query = client
      .from('applications')
      .delete()
      .eq('id', id);
    let beforeData: Record<string, unknown> | null = null;
    if (isAdmin) {
      const { data: existing } = await client.from('applications').select('*').eq('id', id).maybeSingle();
      beforeData = existing as Record<string, unknown> | null;
    }
    if (!isAdmin) query = query.eq('user_id', auth!.user.id);
    const { data: deleted, error } = await query.select('id').maybeSingle();

    if (error) {
      throw new Error(`删除网申记录失败: ${error.message}`);
    }
    if (!deleted) return NextResponse.json({ error: '网申记录不存在' }, { status: 404 });

    if (isAdmin) {
      await recordAdminAuditEvent({
        request,
        action: 'application.delete',
        resourceType: 'application',
        resourceId: id,
        subjectUserId: typeof beforeData?.user_id === 'string' ? beforeData.user_id : null,
        beforeData,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting application:', error);
    if (isAdminRequest) {
      await recordAdminAuditFailure({ request, action: 'application.delete', resourceType: 'application', error });
    }
    return NextResponse.json(
      { error: '删除网申记录失败' },
      { status: 500 }
    );
  }
}
