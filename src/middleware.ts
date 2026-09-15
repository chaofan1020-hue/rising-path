import { NextResponse, type NextRequest } from 'next/server';
import {
  ADMIN_SESSION_COOKIE,
  readCookieValue,
  verifyAdminSessionToken,
} from '@/lib/admin-session-token';

const LOGIN_PATH = '/admin/login';
const PUBLIC_ADMIN_API = new Set([
  '/api/admin/auth/otp',
  '/api/admin/auth/otp/verify',
]);

function isPublicAdminPath(pathname: string, method: string): boolean {
  if (pathname === LOGIN_PATH) return true;
  if (pathname === '/api/admin/auth' && method === 'GET') return true;
  if (pathname === '/api/admin/password' && method === 'POST') return true;
  return PUBLIC_ADMIN_API.has(pathname);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith('/admin') && !pathname.startsWith('/api/admin')) {
    return NextResponse.next();
  }

  if (isPublicAdminPath(pathname, request.method)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value
    || readCookieValue(request.headers.get('cookie'), ADMIN_SESSION_COOKIE);
  const payload = await verifyAdminSessionToken(token || null);
  if (payload) return NextResponse.next();

  if (pathname.startsWith('/api/admin')) {
    return NextResponse.json(
      { data: null, error: { code: 'ADMIN_UNAUTHORIZED', message: '需要管理员权限' } },
      { status: 401 },
    );
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = LOGIN_PATH;
  loginUrl.search = '';
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/admin', '/admin/:path*', '/api/admin/:path*'],
};
