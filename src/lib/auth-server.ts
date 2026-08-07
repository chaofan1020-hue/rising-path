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
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

export function getAuthRedirectOrigin(request: NextRequest): string {
  const configuredOrigin = process.env.AUTH_SITE_URL?.trim();
  if (configuredOrigin) {
    try {
      const parsed = new URL(configuredOrigin);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin;
      }
    } catch {
      // Fall through to the production fail-closed check below.
    }
    throw new Error('AUTH_SITE_URL must be a valid http(s) URL');
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SITE_URL is required in production');
  }

  return request.nextUrl.origin;
}
