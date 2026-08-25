import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthContext(_request);
  if (!auth) return unauthorizedResponse();

  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: '面试记录 ID 无效' }, { status: 400 });
  }

  const { data: interview, error } = await auth.client
    .from('interview_sessions')
    .select('id, target_company, interview_type, mode, total_rounds, current_round, messages, report, report_grade, overall_score, summary, status, created_at, updated_at')
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .eq('status', 'completed')
    .maybeSingle();

  if (error) {
    console.error('[Dashboard interview detail] Failed to load interview:', error);
    return NextResponse.json({ error: '面试记录加载失败' }, { status: 500 });
  }
  if (!interview) {
    return NextResponse.json({ error: '面试记录不存在或无权访问' }, { status: 404 });
  }

  return NextResponse.json({ interview });
}
