import {
  getSupabaseClient,
  getSupabaseServiceRoleKey,
} from '@/storage/database/supabase-client';
import crypto from 'node:crypto';
import {
  getAdminBootstrapPassword,
  isAdminPasswordInput,
  verifyAdminPasswordHash,
} from '@/lib/admin-password';

export const ADMIN_SESSION_COOKIE = 'risingpath_admin_session';
const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

interface AdminSessionPayload {
  issuedAt: number;
  expiresAt: number;
  role?: AdminRole;
}

export type AdminRole = 'super_admin' | 'content_admin' | 'support_admin' | 'legacy_super_admin';

export function isAdminRole(value: unknown): value is Exclude<AdminRole, 'legacy_super_admin'> {
  return value === 'super_admin' || value === 'content_admin' || value === 'support_admin';
}

function getConfiguredAdminRole(): AdminRole {
  const configured = process.env.ADMIN_SESSION_ROLE?.trim();
  return configured === 'super_admin' || configured === 'content_admin' || configured === 'support_admin'
    ? configured
    : 'legacy_super_admin';
}

function getSessionSecret(): string {
  const configuredSecret = process.env.ADMIN_SESSION_SECRET?.trim();
  if (configuredSecret) return configuredSecret;

  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (serviceRoleKey) return serviceRoleKey;

  throw new Error('ADMIN_SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY is required');
}

function signPayload(payload: string): string {
  return crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
}

export function createAdminSessionToken(
  now = Math.floor(Date.now() / 1000),
  role = getConfiguredAdminRole(),
): string {
  const payload: AdminSessionPayload = {
    issuedAt: now,
    expiresAt: now + ADMIN_SESSION_TTL_SECONDS,
    role,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

export function verifyAdminSessionToken(token: string | null): boolean {
  if (!token) return false;

  try {
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [encodedPayload, signature] = parts;
    if (!encodedPayload || !signature) return false;

    const expectedSignature = signPayload(encodedPayload);
    const providedBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expectedSignature);
    if (providedBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(providedBytes, expectedBytes)) {
      return false;
    }

    const parsed: unknown = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return false;
    const payload = parsed as Partial<AdminSessionPayload>;
    return typeof payload.expiresAt === 'number' && payload.expiresAt > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function getCookieValue(request: Request, cookieName: string): string | null {
  const cookies = request.headers.get('cookie')?.split(';') || [];
  const cookie = cookies.find((item) => item.trim().startsWith(`${cookieName}=`));
  if (!cookie) return null;

  const value = cookie.trim().slice(cookieName.length + 1);
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function hasValidAdminSession(request: Request): boolean {
  const authorization = request.headers.get('authorization');
  const bearerToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : null;
  return verifyAdminSessionToken(bearerToken || getCookieValue(request, ADMIN_SESSION_COOKIE));
}

export function getAdminSessionRole(request: Request): AdminRole {
  const authorization = request.headers.get('authorization');
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : getCookieValue(request, ADMIN_SESSION_COOKIE);
  if (!token) return 'legacy_super_admin';
  try {
    const encodedPayload = token.split('.')[0];
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<AdminSessionPayload>;
    return isAdminRole(parsed.role)
      ? parsed.role
      : 'legacy_super_admin';
  } catch {
    return 'legacy_super_admin';
  }
}

export function getAdminSessionCookie(token = createAdminSessionToken()) {
  return {
    name: ADMIN_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  };
}

export function getClearedAdminSessionCookie() {
  return {
    name: ADMIN_SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  };
}

/**
 * 验证管理员密码
 */
export async function verifyAdminPassword(password: string): Promise<boolean> {
  if (!isAdminPasswordInput(password)) return false;
  
  const supabase = getSupabaseClient();
  
  try {
    // 查询数据库中的密码配置
    const { data, error } = await supabase
      .from('job_configs')
      .select('config_value')
      .eq('config_type', 'admin_password_hash')
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        // 没有持久化密码时，只允许部署者显式配置的一次性引导密码。
        return password === getAdminBootstrapPassword();
      }
      console.error('Error fetching password:', error);
      return false;
    }
    
    if (data?.config_value) {
      return (await verifyAdminPasswordHash(password, data.config_value)).valid;
    } else {
      return password === getAdminBootstrapPassword();
    }
  } catch (err) {
    console.error('Password verification error:', err);
    return false;
  }
}
