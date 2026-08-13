import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { adminMigrationUnavailable } from '@/lib/admin-dependency-status';

const MAX_PAGE_SIZE = 100;

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function validDate(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.auditRead);
  if (permissionError) return permissionError;

  const params = request.nextUrl.searchParams;
  const page = positiveInteger(params.get('page'), 1);
  const pageSize = Math.min(positiveInteger(params.get('pageSize'), 50), MAX_PAGE_SIZE);
  const action = params.get('action')?.trim() || null;
  const resourceType = params.get('resourceType')?.trim() || null;
  const subjectUserId = params.get('userId')?.trim() || null;
  const from = validDate(params.get('from'));
  const to = validDate(params.get('to'));
  if ((params.has('from') && !from) || (params.has('to') && !to)) {
    return NextResponse.json({ data: null, error: { code: 'INVALID_DATE', message: '日期参数无效' } }, { status: 400 });
  }

  try {
    const client = getSupabaseClient();
    let query = client
      .from('admin_audit_logs')
      .select('id,actor_type,actor_fingerprint,action,resource_type,resource_id,subject_user_id,metadata,before_data,after_data,success,error_code,error_message,request_id,request_ip,user_agent,created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (action) query = query.eq('action', action);
    if (resourceType) query = query.eq('resource_type', resourceType);
    if (subjectUserId) query = query.eq('subject_user_id', subjectUserId);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lt('created_at', to);
    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: data || [], meta: { page, pageSize, total: count || 0 }, error: null });
  } catch (error) {
    console.error('[AdminAudit] query failed:', error);
    const migrationResponse = adminMigrationUnavailable(error, ['0021_admin_audit_logs.sql'], '审计日志依赖数据库迁移，当前环境尚未部署');
    if (migrationResponse) return migrationResponse;
    return NextResponse.json({ data: null, error: { code: 'ADMIN_AUDIT_QUERY_FAILED', message: '获取审计日志失败' } }, { status: 500 });
  }
}
