export const ADMIN_SESSION_COOKIE = 'risingpath_admin_session';
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

export type AdminRole = 'super_admin' | 'content_admin' | 'support_admin' | 'legacy_super_admin';

export interface AdminSessionPayload {
  issuedAt: number;
  expiresAt: number;
  role?: AdminRole;
  sessionId?: string;
  adminUserId?: string;
}

export function isAdminRole(value: unknown): value is Exclude<AdminRole, 'legacy_super_admin'> {
  return value === 'super_admin' || value === 'content_admin' || value === 'support_admin';
}

export function getAdminSessionSecret(): string | null {
  const configured = process.env.ADMIN_SESSION_SECRET?.trim();
  return configured || null;
}

function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < arr.length; i += 1) binary += String.fromCharCode(arr[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacSign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return bytesToBase64Url(signature);
}

export async function createAdminSessionToken(
  now = Math.floor(Date.now() / 1000),
  role: AdminRole = 'legacy_super_admin',
  extra?: { sessionId?: string; adminUserId?: string; ttlSeconds?: number },
): Promise<string> {
  const secret = getAdminSessionSecret();
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is required');

  const payload: AdminSessionPayload = {
    issuedAt: now,
    expiresAt: now + (extra?.ttlSeconds ?? ADMIN_SESSION_TTL_SECONDS),
    role,
    sessionId: extra?.sessionId,
    adminUserId: extra?.adminUserId,
  };
  const encodedPayload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${encodedPayload}.${await hmacSign(encodedPayload, secret)}`;
}

export async function verifyAdminSessionToken(token: string | null): Promise<AdminSessionPayload | null> {
  if (!token) return null;
  const secret = getAdminSessionSecret();
  if (!secret) return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encodedPayload, signature] = parts;
    if (!encodedPayload || !signature) return null;

    const expected = await hmacSign(encodedPayload, secret);
    const providedBytes = base64UrlToBytes(signature);
    const expectedBytes = base64UrlToBytes(expected);
    if (providedBytes.length !== expectedBytes.length) return null;
    let mismatch = 0;
    for (let i = 0; i < providedBytes.length; i += 1) mismatch |= providedBytes[i]! ^ expectedBytes[i]!;
    if (mismatch !== 0) return null;

    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encodedPayload)));
    if (!parsed || typeof parsed !== 'object') return null;
    const payload = parsed as Partial<AdminSessionPayload>;
    if (typeof payload.expiresAt !== 'number' || payload.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return payload as AdminSessionPayload;
  } catch {
    return null;
  }
}

export function readCookieValue(cookieHeader: string | null | undefined, cookieName: string): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';');
  const cookie = cookies.find((item) => item.trim().startsWith(`${cookieName}=`));
  if (!cookie) return null;
  const value = cookie.trim().slice(cookieName.length + 1);
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function readAdminSessionTokenFromRequest(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  const bearerToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : null;
  return bearerToken || readCookieValue(request.headers.get('cookie'), ADMIN_SESSION_COOKIE);
}

export function getAdminSessionCookie(token: string, maxAge = ADMIN_SESSION_TTL_SECONDS) {
  return {
    name: ADMIN_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
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
