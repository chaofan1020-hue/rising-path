import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { sanitizeResumeRecord } from '@/lib/resume-parser';
import { getUserResume } from '@/lib/resume-selection';

export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();
  try {
    const resume = await getUserResume(auth.client, auth.user.id);
    return NextResponse.json({ resume: resume ? sanitizeResumeRecord(resume) : null, resumeId: resume?.id ?? null });
  } catch (error) {
    console.error('[ActiveResume] read failed:', error);
    return NextResponse.json({ error: '读取当前简历失败' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();
  try {
    const body = await request.json() as { resumeId?: unknown };
    const resumeId = Number(body.resumeId);
    if (!Number.isInteger(resumeId) || resumeId <= 0) {
      return NextResponse.json({ error: '简历 ID 无效' }, { status: 400 });
    }
    const { data: resume } = await auth.client
      .from('resumes')
      .select('id')
      .eq('id', resumeId)
      .eq('user_id', auth.user.id)
      .maybeSingle();
    if (!resume) return NextResponse.json({ error: '简历不存在或无权访问' }, { status: 404 });
    const { error } = await auth.client
      .from('profiles')
      .update({ active_resume_id: resumeId, updated_at: new Date().toISOString() })
      .eq('id', auth.user.id);
    if (error) throw error;
    return NextResponse.json({ resumeId });
  } catch (error) {
    console.error('[ActiveResume] update failed:', error);
    return NextResponse.json({ error: '切换当前简历失败' }, { status: 500 });
  }
}
