'use client';

import { Loader2 } from 'lucide-react';
import { useAdminPermissions } from '@/components/admin-shell';
import type { AdminPermission } from '@/lib/admin-permission-constants';

export function AdminPageShell({
  title,
  description,
  permission,
  actions,
  children,
}: {
  title: string;
  description: string;
  permission: AdminPermission;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { loading, hasPermission } = useAdminPermissions();

  if (loading) {
    return (
      <div className="flex min-h-80 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasPermission(permission)) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          当前角色无权访问此页面
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-zinc-50 dark:bg-zinc-950">
      <div className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex min-h-12 max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{title}</h1>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">{description}</p>
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      </div>
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 md:py-8">{children}</main>
    </div>
  );
}
