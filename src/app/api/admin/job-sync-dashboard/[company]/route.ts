import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { loadJobSyncDashboardCompany } from '@/lib/admin-job-sync-dashboard';
import { adminMigrationUnavailable } from '@/lib/admin-dependency-status';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ company: string }> }) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.dashboardRead);
  if (permissionError) return permissionError;
  try {
    const { company: encodedCompany } = await params;
    const company = await loadJobSyncDashboardCompany(decodeURIComponent(encodedCompany));
    if (!company) return NextResponse.json({ data: null, error: { code: 'COMPANY_NOT_FOUND', message: '未找到该公司来源记录' } }, { status: 404 });
    return NextResponse.json({ data: company, error: null }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch (error) {
    console.error('[Admin Job Sync Dashboard Detail] query failed:', error);
    const migrationResponse = adminMigrationUnavailable(error, ['0099_job_sync_dashboard_telemetry.sql'], '岗位同步大屏依赖数据库迁移，当前环境尚未部署');
    if (migrationResponse) return migrationResponse;
    return NextResponse.json({ data: null, error: { code: 'JOB_SYNC_DASHBOARD_DETAIL_FAILED', message: error instanceof Error ? error.message : '读取公司同步详情失败' } }, { status: 500 });
  }
}
