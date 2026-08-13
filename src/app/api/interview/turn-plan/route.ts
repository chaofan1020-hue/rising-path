import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { consumeAuthRateLimit } from '@/lib/auth-security';
import { parseInterviewContextDigest, parseInterviewFactLedger } from '@/lib/interview-context-memory';
import { createInterviewTurnPlan, signInterviewTurnPlan } from '@/lib/interview-turn-plan';
import { z } from 'zod';

const requestSchema = z.object({
  sessionId: z.number().int().positive(),
  revision: z.number().int().min(0),
  answer: z.string().trim().min(1).max(10_000),
}).strict();

export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();
  const rateLimit = await consumeAuthRateLimit(`interview-plan:user:${auth.user.id}`, 60, 300, 900);
  if (!rateLimit.allowed) return NextResponse.json({ error: '面试规划请求过于频繁' }, { status: 429 });

  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: '面试规划参数无效' }, { status: 400 });
    const { sessionId, revision, answer } = parsed.data;
    const { data: session, error } = await auth.client
      .from('interview_sessions')
      .select('id, status, revision, session_seed, context_digest, facts_ledger, messages')
      .eq('id', sessionId)
      .eq('user_id', auth.user.id)
      .single();
    if (error || !session) return NextResponse.json({ error: '面试会话不存在' }, { status: 404 });
    if (session.status !== 'in_progress') return NextResponse.json({ error: '面试已结束' }, { status: 409 });
    if (Number(session.revision || 0) !== revision) {
      return NextResponse.json({ error: '面试状态已更新', code: 'REVISION_CONFLICT', revision: Number(session.revision || 0) }, { status: 409 });
    }
    const digest = parseInterviewContextDigest(session.context_digest);
    if (!digest || !session.session_seed) return NextResponse.json({ plan: null, token: null });
    const messages = Array.isArray(session.messages) ? session.messages as Array<{ role?: string; content?: string }> : [];
    const previousQuestion = [...messages].reverse().find((message) => message.role === 'interviewer')?.content || '';
    const plan = createInterviewTurnPlan({
      digest,
      ledger: parseInterviewFactLedger(session.facts_ledger),
      previousQuestion,
      answer,
    });
    return NextResponse.json(signInterviewTurnPlan(plan, session.session_seed, sessionId, revision, answer));
  } catch (error) {
    console.error('[Interview turn plan] failed:', error);
    return NextResponse.json({ error: '面试规划暂不可用' }, { status: 503 });
  }
}
