import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { resolveRegionKey, type RegionKey } from '@/lib/region-dna';

function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().slice(0, 120);
  return name || null;
}

function normalizeAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const avatarUrl = value.trim().slice(0, 500);
  if (!avatarUrl) return null;
  try {
    const parsed = new URL(avatarUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizePreferredRegion(value: unknown): RegionKey | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return null;
  return resolveRegionKey(value);
}

function profileData(profile: { id: string; display_name: string | null; avatar_url: string | null; preferred_region?: string | null; updated_at: string | null } | null, email: string | null) {
  return {
    id: profile?.id || null,
    email,
    displayName: profile?.display_name || null,
    avatarUrl: profile?.avatar_url || null,
    preferredRegion: profile?.preferred_region || null,
    updatedAt: profile?.updated_at || null,
  };
}

export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();

  const { data, error } = await auth.client
    .from('profiles')
    .select('id,display_name,avatar_url,preferred_region,updated_at')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ data: null, error: { code: 'PROFILE_QUERY_FAILED', message: '读取个人资料失败' } }, { status: 500 });

  return NextResponse.json({ data: profileData(data, auth.user.email || null), error: null });
}

export async function PATCH(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();

  try {
    const body = await request.json() as Record<string, unknown>;
    const hasDisplayName = Object.prototype.hasOwnProperty.call(body, 'displayName');
    const hasAvatarUrl = Object.prototype.hasOwnProperty.call(body, 'avatarUrl');
    const hasPreferredRegion = Object.prototype.hasOwnProperty.call(body, 'preferredRegion');
    if (!hasDisplayName && !hasAvatarUrl && !hasPreferredRegion) {
      return NextResponse.json({ data: null, error: { code: 'PROFILE_UPDATE_EMPTY', message: '没有需要保存的资料' } }, { status: 400 });
    }

    const update: { id: string; display_name?: string | null; avatar_url?: string | null; preferred_region?: RegionKey | null; updated_at: string } = {
      id: auth.user.id,
      updated_at: new Date().toISOString(),
    };
    if (hasDisplayName) update.display_name = normalizeDisplayName(body.displayName);
    if (hasAvatarUrl) {
      const rawAvatarUrl = body.avatarUrl;
      const avatarUrl = normalizeAvatarUrl(rawAvatarUrl);
      if (typeof rawAvatarUrl === 'string' && rawAvatarUrl.trim() && !avatarUrl) {
        return NextResponse.json({ data: null, error: { code: 'PROFILE_AVATAR_INVALID', message: '头像链接必须是有效的 http(s) 地址' } }, { status: 400 });
      }
      update.avatar_url = avatarUrl;
    }
    if (hasPreferredRegion) {
      const preferredRegion = normalizePreferredRegion(body.preferredRegion);
      if (body.preferredRegion !== null && body.preferredRegion !== '' && !preferredRegion) {
        return NextResponse.json({ data: null, error: { code: 'PROFILE_REGION_INVALID', message: '无效的求职地区' } }, { status: 400 });
      }
      update.preferred_region = preferredRegion;
    }

    const { data, error } = await auth.client
      .from('profiles')
      .upsert(update, { onConflict: 'id' })
      .select('id,display_name,avatar_url,preferred_region,updated_at')
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ data: profileData(data, auth.user.email || null), error: null });
  } catch (error) {
    console.error('[Account] Profile update failed:', error);
    return NextResponse.json({ data: null, error: { code: 'PROFILE_UPDATE_FAILED', message: '保存个人资料失败' } }, { status: 500 });
  }
}
