import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { isApplicationStatus } from '@/lib/application-status';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const { id } = await params;
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

    const { data, error } = await client
      .from('applications')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', auth.user.id)
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
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const { id } = await params;

    const { error } = await client
      .from('applications')
      .delete()
      .eq('id', id)
      .eq('user_id', auth.user.id);

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
