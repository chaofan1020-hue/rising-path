import { NextResponse } from 'next/server';
import {
  countActiveSuperAdmins,
  getAdminSessionRole,
  hasValidAdminSession,
  resolveAdminSession,
  type AdminRole,
} from '@/lib/admin-auth';
import { ADMIN_PERMISSIONS, type AdminPermission } from '@/lib/admin-permission-constants';
import { isAllowedAdminOrigin, rejectedAdminOriginResponse } from '@/lib/admin-origin';

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
    ADMIN_PERMISSIONS.feedbackReview, ADMIN_PERMISSIONS.usersRead, ADMIN_PERMISSIONS.usersWrite,
    ADMIN_PERMISSIONS.billingRead,
  ]),
};

async function hasNoActiveSuperAdmin(): Promise<boolean> {
  try {
    return (await countActiveSuperAdmins()) === 0;
  } catch {
    return false;
  }
}

export function getAdminPermissions(role: AdminRole): AdminPermission[] {
  return Array.from(ROLE_PERMISSIONS[role]);
}

export async function getEffectiveAdminPermissions(role: AdminRole): Promise<AdminPermission[]> {
  const permissions = new Set(getAdminPermissions(role));
  if (!permissions.has(ADMIN_PERMISSIONS.rolesWrite) && await hasNoActiveSuperAdmin()) {
    permissions.add(ADMIN_PERMISSIONS.rolesWrite);
  }
  return Array.from(permissions);
}

export async function roleHasPermission(role: AdminRole, permission: AdminPermission): Promise<boolean> {
  if (ROLE_PERMISSIONS[role]?.has(permission)) return true;
  return permission === ADMIN_PERMISSIONS.rolesWrite && await hasNoActiveSuperAdmin();
}

export async function hasAdminPermission(request: Request, permission: AdminPermission): Promise<boolean> {
  if (!(await hasValidAdminSession(request))) return false;
  return roleHasPermission(await getAdminSessionRole(request), permission);
}

export async function requireAdminPermission(request: Request, permission: AdminPermission): Promise<NextResponse | null> {
  if (!isAllowedAdminOrigin(request)) {
    return NextResponse.json(
      (await rejectedAdminOriginResponse().json()) as Record<string, unknown>,
      { status: 403 },
    );
  }
  const session = await resolveAdminSession(request);
  if (!session) {
    return NextResponse.json({ data: null, error: { code: 'ADMIN_UNAUTHORIZED', message: '需要管理员权限' } }, { status: 401 });
  }
  const role = session.role && ROLE_PERMISSIONS[session.role] ? session.role : 'legacy_super_admin';
  if (!(await roleHasPermission(role, permission))) {
    return NextResponse.json({ data: null, error: { code: 'ADMIN_FORBIDDEN', message: '当前管理员角色没有此权限' } }, { status: 403 });
  }
  return null;
}
