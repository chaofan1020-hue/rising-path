// POST /api/interview/feedback —— 面试真实度问卷提交
// 闭环：评分 <6 → pending_review（低真实度案例，进入人工审查队列）
//       评分 >=6 → high_quality（高质量案例，提问记录保留为训练数据）
import { NextRequest } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { interviewFeedbackRequestSchema } from '@/lib/interview-contracts';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const parsed = interviewFeedbackRequestSchema.safeParse(await request.json());
    if (!parsed.success) return new Response(JSON.stringify({ error: '反馈参数无效' }), { status: 400 });
    const { sessionId, realismScore: score, feedbackText } = parsed.data;

    // Feedback must be tied to the DNA snapshot actually used in this session.
    // Re-fetching here could invoke an LLM and silently associate a newer DNA version.
    const { data: session } = await client
      .from('interview_sessions')
      .select('id, target_company, dna_source, dna_version')
      .eq('id', sessionId)
      .eq('user_id', auth.user.id)
      .eq('status', 'completed')
      .single();
    if (!session) {
      return new Response(JSON.stringify({ error: '会话不存在' }), { status: 404 });
    }

    const company = session.target_company || '';
    const dnaSource = typeof session.dna_source === 'string' ? session.dna_source : null;
    const dnaVersion = typeof session.dna_version === 'number' ? session.dna_version : null;

    const status = score < 6 ? 'pending_review' : 'high_quality';
    const { error } = await client.from('interview_feedback').upsert(
      {
        session_id: sessionId,
        user_id: auth.user.id,
        company,
        realism_score: score,
        feedback_text: feedbackText ? String(feedbackText).slice(0, 2000) : null,
        status,
        dna_source: dnaSource,
        dna_version: dnaVersion,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'session_id' }
    );

    if (error) {
      return new Response(JSON.stringify({ error: '提交失败' }), { status: 500 });
    }
    return new Response(JSON.stringify({ success: true, status }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: '服务器错误' }), { status: 500 });
  }
}
