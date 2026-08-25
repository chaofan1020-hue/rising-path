'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Activity,
  BarChart3,
  BriefcaseBusiness,
  Radio,
  ClipboardList,
  Coins,
  Dna,
  ExternalLink,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ADMIN_PERMISSIONS, type AdminPermission } from '@/lib/admin-permission-constants';

interface AdminPermissionContextValue {
  role: string | null;
  permissions: Set<AdminPermission>;
  loading: boolean;
  hasPermission: (permission: AdminPermission) => boolean;
}

const AdminPermissionContext = createContext<AdminPermissionContextValue>({
  role: null,
  permissions: new Set(),
  loading: true,
  hasPermission: () => false,
});

export function useAdminPermissions() {
  return useContext(AdminPermissionContext);
}

type NavigationItem = { label: string; href: string; icon: typeof LayoutDashboard; permission: AdminPermission };

const navigationGroups: { label: string; items: NavigationItem[] }[] = [
  {
    label: '运营总览',
    items: [
      { label: '运营概览', href: '/admin', icon: LayoutDashboard, permission: ADMIN_PERMISSIONS.dashboardRead },
      { label: '数据与质量', href: '/admin?tab=analytics', icon: BarChart3, permission: ADMIN_PERMISSIONS.dashboardRead },
      { label: '网申质量', href: '/admin?tab=prefill-quality', icon: FileText, permission: ADMIN_PERMISSIONS.dashboardRead },
      { label: 'AI 用量与成本', href: '/admin?tab=ai-usage', icon: Activity, permission: ADMIN_PERMISSIONS.dashboardRead },
      { label: '服务健康', href: '/admin?tab=service-health', icon: Activity, permission: ADMIN_PERMISSIONS.dashboardRead },
    ],
  },
  {
    label: '岗位与企业',
    items: [
      { label: '岗位工作台', href: '/admin?tab=jobs', icon: BriefcaseBusiness, permission: ADMIN_PERMISSIONS.jobsRead },
      { label: '投稿审核', href: '/admin?tab=job-submissions', icon: ClipboardList, permission: ADMIN_PERMISSIONS.jobsRead },
      { label: '岗位轮换', href: '/admin/job-rotation', icon: Radio, permission: ADMIN_PERMISSIONS.dashboardRead },
      { label: '面试基因', href: '/admin/dna-review', icon: Dna, permission: ADMIN_PERMISSIONS.dnaRead },
    ],
  },
  {
    label: '用户运营',
    items: [
      { label: '学生中心', href: '/admin/students', icon: Users, permission: ADMIN_PERMISSIONS.usersRead },
      { label: '内测与积分', href: '/admin/credits', icon: Coins, permission: ADMIN_PERMISSIONS.usersRead },
      { label: '简历处理', href: '/admin?tab=resumes', icon: FileText, permission: ADMIN_PERMISSIONS.usersRead },
      { label: '网申记录', href: '/admin?tab=applications', icon: ClipboardList, permission: ADMIN_PERMISSIONS.usersRead },
    ],
  },
  {
    label: '系统设置',
    items: [
      { label: '配置与品牌', href: '/admin?tab=configs', icon: Settings, permission: ADMIN_PERMISSIONS.configWrite },
      { label: '审计日志', href: '/admin?tab=audit', icon: ClipboardList, permission: ADMIN_PERMISSIONS.auditRead },
      { label: '管理员账号', href: '/admin/accounts', icon: ShieldCheck, permission: ADMIN_PERMISSIONS.rolesWrite },
    ],
  },
];

function isActive(pathname: string, searchParams: URLSearchParams, href: string): boolean {
  if (pathname !== href.split('?')[0]) return false;
  const tab = new URL(href, 'http://localhost').searchParams.get('tab');
  if (pathname === '/admin') return tab
    ? searchParams.get('tab') === tab
    : !searchParams.get('tab') || searchParams.get('tab') === 'overview';
  return true;
}

function roleLabel(role: string | null): string {
  if (role === 'super_admin' || role === 'legacy_super_admin') return '超级管理员';
  if (role === 'content_admin') return '内容管理员';
  if (role === 'support_admin') return '支持管理员';
  return '管理员';
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [permissionLoading, setPermissionLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [permissionKeys, setPermissionKeys] = useState<AdminPermission[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/admin/auth', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        setRole(typeof data.role === 'string' ? data.role : null);
        setPermissionKeys(Array.isArray(data.permissions) ? data.permissions : []);
      })
      .catch(() => {
        if (!cancelled) {
          setRole(null);
          setPermissionKeys([]);
        }
      })
      .finally(() => {
        if (!cancelled) setPermissionLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const permissions = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const permissionContext = useMemo<AdminPermissionContextValue>(() => ({
    role,
    permissions,
    loading: permissionLoading,
    hasPermission: (permission) => permissions.has(permission),
  }), [permissionLoading, permissions, role]);
  const visibleNavigationGroups = permissionLoading
    ? []
    : navigationGroups
      .map((group) => ({ ...group, items: group.items.filter((item) => permissions.has(item.permission)) }))
      .filter((group) => group.items.length > 0);

  const signOut = async () => {
    await fetch('/api/admin/password', { method: 'DELETE' });
    window.location.href = '/admin';
  };

  return (
    <div data-admin-shell className="min-h-screen bg-background text-foreground">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-zinc-200/80 bg-background/95 shadow-sm backdrop-blur-xl dark:border-zinc-800/80">
        <div className="mx-auto flex h-16 min-w-0 items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-background transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800 md:hidden"
              onClick={() => setMobileOpen((open) => !open)}
              aria-label={mobileOpen ? '关闭后台导航' : '打开后台导航'}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <Link href="/admin" className="flex min-w-0 items-center gap-2.5 font-semibold">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"><ShieldCheck className="h-4 w-4" /></span>
              <span className="min-w-0 truncate"><span className="block text-sm font-semibold leading-5">Liorvix</span><span className="block text-[11px] font-normal leading-4 text-zinc-500 dark:text-zinc-400 max-[420px]:hidden">运营后台</span></span>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 sm:inline-flex">{roleLabel(role)}</span>
            <Link href="/" target="_blank" rel="noreferrer">
              <Button variant="ghost" size="sm" className="h-9 px-2.5 sm:px-3">
                <ExternalLink className="h-4 w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">返回前台</span>
              </Button>
            </Link>
            <Button variant="ghost" size="sm" className="h-9 px-2.5 text-muted-foreground hover:text-foreground sm:px-3" onClick={() => void signOut()}>
              <LogOut className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">退出</span>
            </Button>
          </div>
        </div>
      </header>

      <aside className="fixed inset-y-16 left-0 z-40 hidden w-60 border-r border-zinc-200 bg-background md:block dark:border-zinc-800">
        <nav className="h-full overflow-y-auto px-3 py-5" aria-label="管理员导航">
          <div className="space-y-6">
            {visibleNavigationGroups.map((group) => (
              <section key={group.label}>
                <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">{group.label}</p>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(pathname, searchParams, item.href);
                    return <Link key={item.href} href={item.href} className={`group flex min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${active ? 'bg-zinc-900 text-white shadow-sm dark:bg-white dark:text-zinc-900' : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white'}`}>
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>;
                  })}
                </div>
              </section>
            ))}
          </div>
        </nav>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-16 z-40 border-t border-zinc-200 bg-background md:hidden dark:border-zinc-800">
          <nav className="h-full overflow-y-auto p-4" aria-label="管理员导航">
            <div className="space-y-5">
              {visibleNavigationGroups.map((group) => <section key={group.label}>
                <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">{group.label}</p>
                <div className="space-y-1">{group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(pathname, searchParams, item.href);
                  return <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className={`flex min-w-0 items-center gap-3 rounded-lg px-3 py-3 text-sm ${active ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white'}`}><Icon className="h-4 w-4 shrink-0" /><span className="truncate">{item.label}</span></Link>;
                })}</div>
              </section>)}
            </div>
          </nav>
        </div>
      )}

      <AdminPermissionContext.Provider value={permissionContext}>
        <div className="min-h-[calc(100vh-4rem)] pt-16 md:pl-60">{children}</div>
      </AdminPermissionContext.Provider>
    </div>
  );
}
