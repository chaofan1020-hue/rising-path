import { randomUUID } from 'node:crypto';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const RESUME_STORAGE_BUCKET = process.env.SUPABASE_RESUME_BUCKET?.trim() || 'risingpath-resumes';

export class ResumeStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResumeStorageError';
  }
}

function safeFileName(fileName: string): string {
  const baseName = fileName.split(/[\\/]/).pop()?.trim() || 'resume';
  return baseName.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 120) || 'resume';
}

export function createResumeStorageKey(userId: string, fileName: string): string {
  return `${userId}/${randomUUID()}-${safeFileName(fileName)}`;
}

export async function uploadResumeFile(
  buffer: Buffer,
  userId: string,
  fileName: string,
  contentType?: string,
): Promise<string> {
  const key = createResumeStorageKey(userId, fileName);
  const { error } = await getSupabaseClient().storage.from(RESUME_STORAGE_BUCKET).upload(key, buffer, {
    contentType: contentType || 'application/octet-stream',
    cacheControl: '3600',
    upsert: false,
  });

  if (error) {
    console.error('[ResumeStorage] upload failed:', error);
    throw new ResumeStorageError('简历文件保存失败，请稍后重试');
  }

  return key;
}

export async function downloadResumeFile(fileKey: string): Promise<Buffer> {
  const { data, error } = await getSupabaseClient().storage
    .from(RESUME_STORAGE_BUCKET)
    .download(fileKey);

  if (error || !data) {
    console.error('[ResumeStorage] download failed:', error);
    throw new ResumeStorageError('原始简历文件无法读取，请重新上传');
  }

  return Buffer.from(await data.arrayBuffer());
}

export async function deleteResumeFile(fileKey: string): Promise<void> {
  if (!fileKey || fileKey.startsWith('local://')) return;

  const { error } = await getSupabaseClient().storage
    .from(RESUME_STORAGE_BUCKET)
    .remove([fileKey]);
  if (error) {
    throw new ResumeStorageError(`原始简历文件清理失败: ${error.message}`);
  }
}
