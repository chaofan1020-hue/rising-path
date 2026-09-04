import { NextResponse } from 'next/server';
import { getAdminSessionRole, hasValidAdminSession, type AdminRole } from '@/lib/admin-auth';
import { ADMIN_PERMISSIONS, type AdminPermission } from '@/lib/admin-permission-constants';

export { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';
export type { AdminPermission } from '@/lib/admin-permission-constants';

const ROLE_PERMISSIONS: Record<AdminRole, ReadonlySet<AdminPermission>> = {
  super_admin: new Set(Object.values(ADMIN_PERMISSIONS)),
  legacy_super_admin: new Set(Object.values(ADMIN_PERMISSIONS)),
  content_admin: new Set([
    ADMIN_PERMISSIONS.dashboardRead, ADMIN_PERMISSIONS.jobSyncWrite, ADMIN_PERMISSIONS.dnaRead, ADMIN_PERMISSIONS.dnaWrite,
    ADMIN_PERMISSIONS.dnaPublish, ADMIN_PERMISSIONS.feedbackRead, ADMIN_PERMISSIONS.feedbackReview,
    ADMIN_PERMISSIONS.jobsRead, ADMIN_PERMISSIONS.jobsWrite,
  ]),
  support_admin: new Set([
    ADMIN_PERMISSIONS.dashboardRead, ADMIN_PERMISSIONS.feedbackRead,
    ADMIN_PERMISSIONS.feedbackReview, ADMIN_PERMISSIONS.usersRead,
  ]),
};

export function getAdminPermissions(role: AdminRole): AdminPermission[] {
  return Array.from(ROLE_PERMISSIONS[role]);
}

export function hasAdminPermission(request: Request, permission: AdminPermission): boolean {
  if (!hasValidAdminSession(request)) return false;
  return ROLE_PERMISSIONS[getAdminSessionRole(request)].has(permission);
}

export function requireAdminPermission(request: Request, permission: AdminPermission): NextResponse | null {
  if (!hasValidAdminSession(request)) {
    return NextResponse.json({ data: null, error: { code: 'ADMIN_UNAUTHORIZED', message: '需要管理员权限' } }, { status: 401 });
  }
  if (!hasAdminPermission(request, permission)) {
    return NextResponse.json({ data: null, error: { code: 'ADMIN_FORBIDDEN', message: '当前管理员角色没有此权限' } }, { status: 403 });
  }
  return null;
}
