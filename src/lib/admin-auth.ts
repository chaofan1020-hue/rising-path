import crypto from 'node:crypto';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import {
  getAdminBootstrapPassword,
  isAdminPasswordInput,
  verifyAdminPasswordHash,
} from '@/lib/admin-password';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSessionToken,
  getAdminSessionCookie as buildAdminSessionCookie,
  getClearedAdminSessionCookie,
  isAdminRole,
  readAdminSessionTokenFromRequest,
  verifyAdminSessionToken,
  type AdminRole,
  type AdminSessionPayload,
} from '@/lib/admin-session-token';

export {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSessionToken,
  getClearedAdminSessionCookie,
  isAdminRole,
  type AdminRole,
};

export function getAdminSessionCookie(token: string) {
  return buildAdminSessionCookie(token);
}

function hashIp(request?: Request): string | null {
  const forwarded = request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || request?.headers.get('x-real-ip')?.trim() || '';
  if (!ip) return null;
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

export async function parseAdminSession(request: Request): Promise<AdminSessionPayload | null> {
  return verifyAdminSessionToken(readAdminSessionTokenFromRequest(request));
}

export async function hasValidAdminSession(request: Request): Promise<boolean> {
  const payload = await resolveAdminSession(request);
  return Boolean(payload);
}

export async function getAdminSessionRole(request: Request): Promise<AdminRole> {
  const payload = await resolveAdminSession(request);
  return payload?.role && (isAdminRole(payload.role) || payload.role === 'legacy_super_admin')
    ? payload.role
    : 'legacy_super_admin';
}

export async function resolveAdminSession(request: Request): Promise<AdminSessionPayload | null> {
  const payload = await parseAdminSession(request);
  if (!payload) return null;

  if (!payload.sessionId || !payload.adminUserId) {
    if (process.env.NODE_ENV !== 'production' || process.env.ADMIN_ALLOW_LEGACY_SESSION === 'true') {
      return payload;
    }
    if (await isSharedAdminPasswordAllowed()) return payload;
    return null;
  }

  try {
    const { data, error } = await getSupabaseClient()
      .from('admin_sessions')
      .select('id, revoked_at, expires_at, admin_users!inner(id, status, role_key)')
      .eq('id', payload.sessionId)
      .eq('admin_user_id', payload.adminUserId)
      .maybeSingle();
    if (error || !data || data.revoked_at) return null;
    if (new Date(data.expires_at).getTime() <= Date.now()) return null;
    const adminUser = Array.isArray(data.admin_users) ? data.admin_users[0] : data.admin_users;
    if (!adminUser || adminUser.status !== 'active') return null;
    const role = isAdminRole(adminUser.role_key) ? adminUser.role_key : payload.role;
    return { ...payload, role: role || payload.role };
  } catch (error) {
    console.error('[Admin Auth] session lookup failed:', error);
    return null;
  }
}

export async function issueAdminSession(options: {
  adminUserId: string;
  role: AdminRole;
  request?: Request;
}): Promise<ReturnType<typeof getAdminSessionCookie>> {
  const sessionId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = new Date((now + ADMIN_SESSION_TTL_SECONDS) * 1000).toISOString();
  const { error } = await getSupabaseClient().from('admin_sessions').insert({
    id: sessionId,
    admin_user_id: options.adminUserId,
    expires_at: expiresAt,
    last_seen_at: new Date().toISOString(),
    ip_hash: hashIp(options.request),
    user_agent: options.request?.headers.get('user-agent')?.slice(0, 500) || null,
  });
  if (error) throw new Error(error.message);
  const token = await createAdminSessionToken(now, options.role, {
    sessionId,
    adminUserId: options.adminUserId,
  });
  return getAdminSessionCookie(token);
}

export async function revokeAdminSession(sessionId: string): Promise<void> {
  await getSupabaseClient()
    .from('admin_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', sessionId)
    .is('revoked_at', null);
}

export async function revokeAdminSessionsForUser(adminUserId: string): Promise<void> {
  await getSupabaseClient()
    .from('admin_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('admin_user_id', adminUserId)
    .is('revoked_at', null);
}

export async function countActiveAdminUsers(): Promise<number> {
  const { count, error } = await getSupabaseClient()
    .from('admin_users')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active');
  if (error) throw new Error(error.message);
  return count || 0;
}

export async function countActiveSuperAdmins(): Promise<number> {
  const { count, error } = await getSupabaseClient()
    .from('admin_users')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .eq('role_key', 'super_admin');
  if (error) throw new Error(error.message);
  return count || 0;
}

export async function isSharedAdminPasswordAllowed(): Promise<boolean> {
  if (process.env.ADMIN_ALLOW_SHARED_PASSWORD === 'true') return true;
  try {
    return (await countActiveSuperAdmins()) === 0;
  } catch {
    return process.env.NODE_ENV !== 'production';
  }
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  if (!isAdminPasswordInput(password)) return false;

  const supabase = getSupabaseClient();

  try {
    const { data, error } = await supabase
      .from('job_configs')
      .select('config_value')
      .eq('config_type', 'admin_password_hash')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return password === getAdminBootstrapPassword();
      }
      console.error('Error fetching password:', error);
      return false;
    }

    if (data?.config_value) {
      return (await verifyAdminPasswordHash(password, data.config_value)).valid;
    }
    return password === getAdminBootstrapPassword();
  } catch (err) {
    console.error('Password verification error:', err);
    return false;
  }
}
