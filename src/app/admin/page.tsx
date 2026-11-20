import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { AdminOverviewPanel } from '@/components/admin/overview-panel';
import { AdminPageShell } from '@/components/admin/page-shell';
import { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';
import { getAdminAnalytics } from '@/lib/admin-analytics';
import { getAdminRequestContext } from '@/lib/admin-request-context';

/**
 * Dashboard data is fetched on the server, so a warm payload is already inside
 * the HTML (no `/api/admin/analytics` request after hydration).
 *
 * The aggregate itself is not cheap, so the payload sits behind a Suspense
 * boundary: on a cache miss the shell still paints immediately and the numbers
 * stream into the same response instead of holding the whole document hostage.
 *
 * Range switching still goes through the API route; the server-rendered payload
 * only covers the default range.
 */
async function DashboardContent({ canRead }: { canRead: boolean }) {
  const initial = canRead ? await getAdminAnalytics('7d').catch(() => null) : null;
  return <AdminOverviewPanel initialAnalytics={initial?.data ?? null} />;
}

function DashboardFallback() {
  return (
    <AdminPageShell
      title="工作台"
      description="核心业务数据与待处理入口"
      permission={ADMIN_PERMISSIONS.dashboardRead}
    >
      <div className="py-16 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">加载分析数据...</p>
      </div>
    </AdminPageShell>
  );
}

export default async function AdminOverviewPage() {
  const { permissions } = await getAdminRequestContext();
  const canRead = permissions.includes(ADMIN_PERMISSIONS.dashboardRead);

  return (
    <Suspense fallback={<DashboardFallback />}>
      <DashboardContent canRead={canRead} />
    </Suspense>
  );
}