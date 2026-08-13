import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export interface AuthContext {
  user: User;
  accessToken: string;
  client: SupabaseClient;
}

export function getBearerToken(request: Request): string | null {
  const value = request.headers.get('authorization');
  if (!value || !value.startsWith('Bearer ')) return null;
  const token = value.slice('Bearer '.length).trim();
  return token || null;
}

export async function getAuthContext(request: NextRequest): Promise<AuthContext | null> {
  const accessToken = getBearerToken(request);
  if (!accessToken) return null;

  try {
    const client = getSupabaseClient(accessToken);
    const { data, error } = await client.auth.getUser(accessToken);
    if (error || !data.user) return null;
    return { user: data.user, accessToken, client };
  } catch (error) {
    console.error('[Auth] Failed to validate access token:', error);
    return null;
  }
}

export function unauthorizedResponse(message = '请先登录'): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function getClientIp(request: Request): string {
  const normalizeIp = (value: string | null): string => {
    const ip = value?.trim();
    if (!ip || ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1') {
      return 'unknown';
    }
    return ip;
  };
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return normalizeIp(forwarded.split(',')[0] ?? null);
  return normalizeIp(request.headers.get('x-real-ip'));
}

export function getAuthRedirectOrigin(request: NextRequest): string {
  const isProductionLike =
    process.env.NODE_ENV === 'production';
  const configuredOrigin = process.env.AUTH_SITE_URL?.trim();
  if (configuredOrigin) {
    let parsed: URL;
    try {
      parsed = new URL(configuredOrigin);
    } catch {
      throw new Error('AUTH_SITE_URL must be a valid http(s) URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('AUTH_SITE_URL must be a valid http(s) URL');
    }

    const isLoopback =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1' ||
      parsed.hostname === '0.0.0.0';
    if (isProductionLike && isLoopback) {
      throw new Error('AUTH_SITE_URL must be a public test or production URL');
    }
    // When developing from another device, prefer the host used by that
    // device over a local-only AUTH_SITE_URL such as localhost.
    if (!isProductionLike && isLoopback) {
      const requestHostname = request.nextUrl.hostname;
      const requestIsLoopback =
        requestHostname === 'localhost' ||
        requestHostname === '127.0.0.1' ||
        requestHostname === '::1';
      if (!requestIsLoopback) return request.nextUrl.origin;
    }
    return parsed.origin;
  }

  if (isProductionLike) {
    throw new Error('AUTH_SITE_URL is required in production');
  }

  return request.nextUrl.origin;
}
