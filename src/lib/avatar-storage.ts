import { randomUUID } from 'node:crypto';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const AVATAR_STORAGE_BUCKET = 'risingpath-assets';

function extensionForType(contentType: string): string {
  switch (contentType) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    default: return 'bin';
  }
}

export async function uploadAvatarFile(buffer: Buffer, userId: string, contentType: string): Promise<string> {
  const key = `avatars/${userId}/${randomUUID()}.${extensionForType(contentType)}`;
  const storage = getSupabaseClient().storage.from(AVATAR_STORAGE_BUCKET);
  const { error } = await storage.upload(key, buffer, {
    contentType,
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw new Error(`Avatar upload failed: ${error.message}`);
  return storage.getPublicUrl(key).data.publicUrl;
}
