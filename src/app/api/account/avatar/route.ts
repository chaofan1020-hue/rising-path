import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { uploadAvatarFile } from '@/lib/avatar-storage';

const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: { code: 'AVATAR_FILE_REQUIRED', message: '请选择头像文件' } }, { status: 400 });
    }
    if (file.size === 0 || file.size > MAX_AVATAR_SIZE) {
      return NextResponse.json({ error: { code: 'AVATAR_FILE_TOO_LARGE', message: '头像文件不能超过 5MB' } }, { status: 413 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: { code: 'AVATAR_FILE_TYPE', message: '头像仅支持 JPG、PNG、WebP 或 GIF' } }, { status: 400 });
    }

    const avatarUrl = await uploadAvatarFile(Buffer.from(await file.arrayBuffer()), auth.user.id, file.type);
    const { data, error } = await auth.client
      .from('profiles')
      .upsert({ id: auth.user.id, avatar_url: avatarUrl, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select('id,display_name,avatar_url,preferred_region,updated_at')
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ data: { id: data.id, email: auth.user.email || null, displayName: data.display_name, avatarUrl: data.avatar_url, preferredRegion: data.preferred_region || null, updatedAt: data.updated_at }, error: null });
  } catch (error) {
    console.error('[Account] Avatar upload failed:', error);
    return NextResponse.json({ error: { code: 'AVATAR_UPLOAD_FAILED', message: '头像上传失败，请稍后重试' } }, { status: 500 });
  }
}
