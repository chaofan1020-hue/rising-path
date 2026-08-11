import type { SupabaseClient } from '@supabase/supabase-js';

type ResumeAccessResult =
  | { ok: true; resume: Record<string, unknown> & { id: number } }
  | { ok: false; status: 404 | 409; error: string };

export async function requireConfirmedResume(
  client: SupabaseClient,
  resumeId: unknown,
  userId: string,
): Promise<ResumeAccessResult> {
  const id = Number(resumeId);
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, status: 404, error: '简历不存在或无权访问' };
  }

  const { data, error } = await client
    .from('resumes')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return { ok: false, status: 404, error: '简历不存在或无权访问' };
  }

  if (data.processing_status !== 'ready' || data.segmentation_confirmed !== true) {
    return { ok: false, status: 409, error: '请先完成简历解析并确认求职画像' };
  }

  if (!data.profile || !data.segmentation || !data.profile_version) {
    return { ok: false, status: 409, error: '当前简历画像版本不完整，请重新确认或解析' };
  }

  return { ok: true, resume: data as Record<string, unknown> & { id: number } };
}
