import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { loadJobSyncDashboard } from '@/lib/admin-job-sync-dashboard';
import { DASHBOARD_FIELDS, type DashboardField, type DashboardStatus } from '@/lib/job-sync-dashboard';
import { adminMigrationUnavailable } from '@/lib/admin-dependency-status';

export const dynamic = 'force-dynamic';

const STATUS_FILTERS = new Set(['all', 'healthy', 'attention', 'failed', 'running', 'retrying', 'stalled', 'discovery_required', 'unknown']);
const SORTS = new Set(['status', 'jobs', 'last_success']);

function sortRank(status: DashboardStatus): number {
  return { failed: 0, stalled: 1, retrying: 2, discovery_required: 3, attention: 4, unknown: 5, running: 6, healthy: 7 }[status];
}

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.dashboardRead);
  if (permissionError) return permissionError;
  try {
    const dashboard = await loadJobSyncDashboard();
    const params = request.nextUrl.searchParams;
    const status = params.get('status') || 'all';
    const sourceType = params.get('source_type')?.trim().toLowerCase() || '';
    const field = params.get('field')?.trim() as DashboardField | null;
    const search = params.get('search')?.trim().toLowerCase() || '';
    const sort = params.get('sort') || 'status';
    if (!STATUS_FILTERS.has(status)) return NextResponse.json({ error: '状态筛选无效' }, { status: 400 });
    if (sort && !SORTS.has(sort)) return NextResponse.json({ error: '排序方式无效' }, { status: 400 });
    if (field && !DASHBOARD_FIELDS.includes(field)) return NextResponse.json({ error: '字段筛选无效' }, { status: 400 });

    let companies = dashboard.companies.filter((company) => {
      if (status !== 'all' && (status === 'attention' ? !['attention', 'retrying', 'stalled', 'discovery_required', 'unknown'].includes(company.status) : company.status !== status)) return false;
      if (sourceType && company.source.type.toLowerCase() !== sourceType) return false;
      if (field && company.official.fields[field]) {
        const value = company.official.fields[field];
        if (value.pending_recheck === 0 && value.rejected_legacy === 0) return false;
      } else if (field) return false;
      if (search && !company.companyName.toLowerCase().includes(search)) return false;
      return true;
    });
    companies = [...companies].sort((left, right) => {
      if (sort === 'jobs') return right.counts.localActiveJobs - left.counts.localActiveJobs || left.companyName.localeCompare(right.companyName);
      if (sort === 'last_success') return (Date.parse(right.feed.lastSuccessAt || '') || 0) - (Date.parse(left.feed.lastSuccessAt || '') || 0);
      return sortRank(left.status) - sortRank(right.status) || right.counts.localActiveJobs - left.counts.localActiveJobs;
    });
    return NextResponse.json({ ...dashboard, companies, meta: { filters: { status, sourceType: sourceType || null, field: field || null, search: search || null, sort } } }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch (error) {
    console.error('[Admin Job Sync Dashboard] query failed:', error);
    const migrationResponse = adminMigrationUnavailable(error, ['0099_job_sync_dashboard_telemetry.sql'], '岗位同步大屏依赖数据库迁移，当前环境尚未部署');
    if (migrationResponse) return migrationResponse;
    return NextResponse.json({ error: error instanceof Error ? error.message : '读取岗位同步大屏失败' }, { status: 500 });
  }
}
