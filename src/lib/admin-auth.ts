import {
  getSupabaseClient,
  getSupabaseServiceRoleKey,
} from '@/storage/database/supabase-client';
import crypto from 'node:crypto';

const DEFAULT_PASSWORD = 'risingpath2024';
export const ADMIN_SESSION_COOKIE = 'risingpath_admin_session';
const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

interface AdminSessionPayload {
  issuedAt: number;
  expiresAt: number;
}

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + 'risingpath_salt').digest('hex');
}

function verifyPassword(inputPassword: string, hashedPassword: string): boolean {
  return hashPassword(inputPassword) === hashedPassword;
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

export function createAdminSessionToken(now = Math.floor(Date.now() / 1000)): string {
  const payload: AdminSessionPayload = {
    issuedAt: now,
    expiresAt: now + ADMIN_SESSION_TTL_SECONDS,
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
  if (!password) return false;
  
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
        // 没有自定义密码，使用默认密码
        return password === DEFAULT_PASSWORD;
      }
      console.error('Error fetching password:', error);
      return false;
    }
    
    if (data?.config_value) {
      // 使用自定义密码验证（数据库中存储的是哈希值）
      return verifyPassword(password, data.config_value);
    } else {
      // 没有自定义密码，使用默认密码
      return password === DEFAULT_PASSWORD;
    }
  } catch (err) {
    console.error('Password verification error:', err);
    return false;
  }
}
