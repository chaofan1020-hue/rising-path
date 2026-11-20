import { cache } from 'react';
import { cookies } from 'next/headers';
import { resolveAdminSessionToken } from '@/lib/admin-auth';
import { getEffectiveAdminPermissions } from '@/lib/admin-permissions';
import { ADMIN_SESSION_COOKIE } from '@/lib/admin-session-token';
import type { AdminPermission } from '@/lib/admin-permission-constants';
import type { AdminSessionPayload } from '@/lib/admin-session-token';

export interface AdminRequestContext {
  session: AdminSessionPayload | null;
  role: string | null;
  permissions: AdminPermission[];
  authenticated: boolean;
}

/**
 * Session + permissions for the current server render.
 *
 * Wrapped in `cache()` so the admin layout and the page below it resolve the
 * session once per request instead of hitting `admin_sessions` twice. Never use
 * this from a client component or a route handler — route handlers must call
 * `requireAdminPermission` so the origin check still runs.
 */
export const getAdminRequestContext = cache(async (): Promise<AdminRequestContext> => {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value ?? null;
  const session = await resolveAdminSessionToken(token);
  const role = session?.role ?? null;
  const permissions = role ? await getEffectiveAdminPermissions(role) : [];

  return { session, role, permissions, authenticated: Boolean(session) };
});