import type { Session, User } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

export const LOCAL_DEV_AUTH_HEADER = 'x-liorvix-dev-auth';
export const LOCAL_DEV_AUTH_VALUE = 'local';
export const LOCAL_DEV_ACCESS_TOKEN = 'local-dev';
export const LOCAL_DEV_USER_ID = '00000000-0000-4000-a000-000000000001';
export const LOCAL_DEV_USER_EMAIL = 'local-dev@localhost';

export function isLocalDevAuthEnabled(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export function hasLocalDevAuthHeader(request: Request): boolean {
  return request.headers.get(LOCAL_DEV_AUTH_HEADER)?.trim().toLowerCase() === LOCAL_DEV_AUTH_VALUE;
}

export function isLocalDevAccessToken(token: string | null | undefined): boolean {
  return token === LOCAL_DEV_ACCESS_TOKEN;
}

export function createLocalDevUser(userId = LOCAL_DEV_USER_ID): User {
  return {
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: LOCAL_DEV_USER_EMAIL,
    email_confirmed_at: '2026-01-01T00:00:00.000Z',
    phone: '',
    confirmed_at: '2026-01-01T00:00:00.000Z',
    last_sign_in_at: '2026-01-01T00:00:00.000Z',
    app_metadata: { provider: 'dev', providers: ['dev'] },
    user_metadata: { username: 'Local Dev' },
    identities: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    is_anonymous: false,
  } as User;
}

export function createLocalDevSession(userId = LOCAL_DEV_USER_ID): Session {
  return {
    access_token: LOCAL_DEV_ACCESS_TOKEN,
    refresh_token: LOCAL_DEV_ACCESS_TOKEN,
    token_type: 'bearer',
    expires_in: 60 * 60 * 24 * 30,
    expires_at: 1893456000,
    user: createLocalDevUser(userId),
  };
}

let resolvedUserId: string | null = null;

export async function resolveLocalDevUserId(client: SupabaseClient): Promise<string> {
  if (resolvedUserId) return resolvedUserId;
  const { data } = await client
    .from('resumes')
    .select('user_id')
    .eq('segmentation_confirmed', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  resolvedUserId = typeof data?.user_id === 'string' && data.user_id
    ? data.user_id
    : LOCAL_DEV_USER_ID;
  return resolvedUserId;
}
