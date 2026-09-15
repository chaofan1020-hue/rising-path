import type { SupabaseClient } from '@supabase/supabase-js';

export async function getUserResume(
  client: SupabaseClient,
  userId: string,
  requestedResumeId?: unknown,
) {
  const parsedId = requestedResumeId == null || requestedResumeId === '' ? null : Number(requestedResumeId);
  if (parsedId !== null && (!Number.isInteger(parsedId) || parsedId <= 0)) return null;

  let selectedId = parsedId;
  if (!selectedId) {
    // The column was introduced after the original resume flow. Keep the
    // latest-resume fallback so older databases continue to work during rollout.
    const { data: profile } = await client
      .from('profiles')
      .select('active_resume_id')
      .eq('id', userId)
      .maybeSingle();
    const activeId = Number(profile?.active_resume_id);
    if (Number.isInteger(activeId) && activeId > 0) selectedId = activeId;
  }

  let query = client
    .from('resumes')
    .select('*')
    .eq('user_id', userId);
  query = selectedId ? query.eq('id', selectedId) : query.order('created_at', { ascending: false }).limit(1);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`读取当前简历失败: ${error.message}`);
  if (data || parsedId || !selectedId) return data || null;
  const { data: fallback, error: fallbackError } = await client
    .from('resumes')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (fallbackError) throw new Error(`读取备用简历失败: ${fallbackError.message}`);
  return fallback || null;
}
