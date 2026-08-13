'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Activity,
  BarChart3,
  BriefcaseBusiness,
  Radio,
  ClipboardList,
  Dna,
  ExternalLink,
  FileText,
  Image,
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
    label: '概览与分析',
    items: [
      { label: '运营概览', href: '/admin', icon: LayoutDashboard, permission: ADMIN_PERMISSIONS.dashboardRead },
      { label: 'AI 用量与成本', href: '/admin?tab=ai-usage', icon: Activity, permission: ADMIN_PERMISSIONS.dashboardRead },
      { label: '业务数据分析', href: '/admin?tab=analytics', icon: BarChart3, permission: ADMIN_PERMISSIONS.dashboardRead },
      { label: '网申质量', href: '/admin?tab=prefill-quality', icon: FileText, permission: ADMIN_PERMISSIONS.dashboardRead },
      { label: '服务健康', href: '/admin?tab=service-health', icon: Activity, permission: ADMIN_PERMISSIONS.dashboardRead },
    ],
  },
  {
    label: '岗位运营',
    items: [
      { label: '岗位管理', href: '/admin?tab=jobs', icon: BriefcaseBusiness, permission: ADMIN_PERMISSIONS.jobsRead },
      { label: '投稿审核', href: '/admin?tab=job-submissions', icon: ClipboardList, permission: ADMIN_PERMISSIONS.jobsRead },
      { label: '岗位轮换', href: '/admin/job-rotation', icon: Radio, permission: ADMIN_PERMISSIONS.dashboardRead },
      { label: 'DNA 审核', href: '/admin/dna-review', icon: Dna, permission: ADMIN_PERMISSIONS.dnaRead },
    ],
  },
  {
    label: '学生与业务',
    items: [
      { label: '学生中心', href: '/admin/students', icon: Users, permission: ADMIN_PERMISSIONS.usersRead },
      { label: '简历处理', href: '/admin?tab=resumes', icon: FileText, permission: ADMIN_PERMISSIONS.usersRead },
      { label: '网申记录', href: '/admin?tab=applications', icon: ClipboardList, permission: ADMIN_PERMISSIONS.usersRead },
    ],
  },
  {
    label: '系统管理',
    items: [
      { label: '岗位与企业配置', href: '/admin?tab=configs', icon: Settings, permission: ADMIN_PERMISSIONS.configWrite },
      { label: '品牌资源', href: '/admin?tab=logos', icon: Image, permission: ADMIN_PERMISSIONS.configWrite },
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
    <div data-admin-shell className="min-h-screen bg-muted/30 text-foreground">
      <header className="fixed inset-x-0 top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-14 min-w-0 items-center justify-between gap-2 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border md:hidden"
              onClick={() => setMobileOpen((open) => !open)}
              aria-label={mobileOpen ? '关闭后台导航' : '打开后台导航'}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <Link href="/admin" className="flex min-w-0 items-center gap-2 font-semibold">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <span className="truncate max-[380px]:hidden">Liorvix 管理后台</span>
            </Link>
          </div>
          <div className="flex items-center gap-1">
            <Link href="/" target="_blank" rel="noreferrer">
              <Button variant="ghost" size="sm" className="h-9 px-2 sm:px-3">
                <ExternalLink className="h-4 w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">返回前台</span>
              </Button>
            </Link>
            <Button variant="ghost" size="sm" className="h-9 px-2 sm:px-3" onClick={() => void signOut()}>
              <LogOut className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">退出</span>
            </Button>
          </div>
        </div>
      </header>

      <aside className="fixed inset-y-14 left-0 z-40 hidden w-56 border-r bg-background md:block">
        <nav className="h-full overflow-y-auto p-3" aria-label="管理员导航">
          <div className="space-y-5">
            {visibleNavigationGroups.map((group) => (
              <section key={group.label}>
                <p className="px-3 pb-1.5 text-xs font-medium text-muted-foreground">{group.label}</p>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(pathname, searchParams, item.href);
                    return <Link key={item.href} href={item.href} className={`flex min-w-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
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
        <div className="fixed inset-14 z-40 bg-background md:hidden">
          <nav className="h-full overflow-y-auto p-4" aria-label="管理员导航">
            <div className="space-y-5">
              {visibleNavigationGroups.map((group) => <section key={group.label}>
                <p className="px-3 pb-1.5 text-xs font-medium text-muted-foreground">{group.label}</p>
                <div className="space-y-1">{group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(pathname, searchParams, item.href);
                  return <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className={`flex min-w-0 items-center gap-3 rounded-md px-3 py-3 text-sm ${active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><Icon className="h-4 w-4 shrink-0" /><span className="truncate">{item.label}</span></Link>;
                })}</div>
              </section>)}
            </div>
          </nav>
        </div>
      )}

      <AdminPermissionContext.Provider value={permissionContext}>
        <div className="pt-14 md:pl-56">{children}</div>
      </AdminPermissionContext.Provider>
    </div>
  );
}
