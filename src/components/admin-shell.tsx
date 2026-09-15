'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ExternalLink, LogOut, Menu, ShieldCheck, X } from 'lucide-react';
import { createContext, Suspense, useContext, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { adminNavigation, isAdminNavActive } from '@/lib/admin-nav';
import { type AdminPermission } from '@/lib/admin-permission-constants';

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

function roleLabel(role: string | null): string {
  if (role === 'super_admin' || role === 'legacy_super_admin') return '超级管理员';
  if (role === 'content_admin') return '内容管理员';
  if (role === 'support_admin') return '支持管理员';
  return '管理员';
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-50 dark:bg-zinc-950" />}>
      <AdminShellInner>{children}</AdminShellInner>
    </Suspense>
  );
}

function AdminShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isLogin = pathname === '/admin/login';
  const [mobileOpen, setMobileOpen] = useState(false);
  const [permissionLoading, setPermissionLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [permissionKeys, setPermissionKeys] = useState<AdminPermission[]>([]);

  useEffect(() => {
    if (isLogin) {
      setPermissionLoading(false);
      return;
    }
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
  }, [isLogin]);

  const permissions = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const permissionContext = useMemo<AdminPermissionContextValue>(() => ({
    role,
    permissions,
    loading: permissionLoading,
    hasPermission: (permission) => permissions.has(permission),
  }), [permissionLoading, permissions, role]);

  const visibleItems = permissionLoading
    ? []
    : adminNavigation.filter((item) => permissions.has(item.permission));

  const signOut = async () => {
    await fetch('/api/admin/password', { method: 'DELETE' });
    window.location.href = '/admin/login';
  };

  if (isLogin) {
    return <AdminPermissionContext.Provider value={permissionContext}>{children}</AdminPermissionContext.Provider>;
  }

  return (
    <div data-admin-shell className="min-h-screen bg-zinc-50 text-foreground dark:bg-zinc-950">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="flex h-14 min-w-0 items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white md:hidden dark:border-zinc-800 dark:bg-zinc-900"
              onClick={() => setMobileOpen((open) => !open)}
              aria-label={mobileOpen ? '关闭后台导航' : '打开后台导航'}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <Link href="/admin" className="flex min-w-0 items-center gap-2.5 font-semibold">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <span className="min-w-0 truncate">
                <span className="block text-sm font-semibold leading-5">Liorvix</span>
                <span className="block text-[11px] font-normal leading-4 text-zinc-500 max-[420px]:hidden">运营后台</span>
              </span>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 sm:inline-flex">
              {roleLabel(role)}
            </span>
            <Link href="/" target="_blank" rel="noreferrer">
              <Button variant="ghost" size="sm" className="h-9 px-2.5 sm:px-3">
                <ExternalLink className="h-4 w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">前台</span>
              </Button>
            </Link>
            <Button variant="ghost" size="sm" className="h-9 px-2.5 text-muted-foreground hover:text-foreground sm:px-3" onClick={() => void signOut()}>
              <LogOut className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">退出</span>
            </Button>
          </div>
        </div>
      </header>

      <aside className="fixed inset-y-14 left-0 z-40 hidden w-56 border-r border-zinc-200 bg-white md:block dark:border-zinc-800 dark:bg-zinc-950">
        <nav className="h-full overflow-y-auto px-3 py-4" aria-label="管理员导航">
          <div className="space-y-0.5">
            {visibleItems.map((item) => {
              const Icon = item.icon;
              const active = isAdminNavActive(pathname, searchParams, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    active
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                      : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-14 z-40 border-t border-zinc-200 bg-white md:hidden dark:border-zinc-800 dark:bg-zinc-950">
          <nav className="h-full overflow-y-auto p-4" aria-label="管理员导航">
            <div className="space-y-1">
              {visibleItems.map((item) => {
                const Icon = item.icon;
                const active = isAdminNavActive(pathname, searchParams, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex min-w-0 items-center gap-3 rounded-lg px-3 py-3 text-sm ${
                      active
                        ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                        : 'text-zinc-600 hover:bg-zinc-100'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      )}

      <AdminPermissionContext.Provider value={permissionContext}>
        <div className="min-h-[calc(100vh-3.5rem)] pt-14 md:pl-56">{children}</div>
      </AdminPermissionContext.Provider>
    </div>
  );
}
