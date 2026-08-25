import { createHash, randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { realtimeTicketRequestSchema } from '@/lib/interview-contracts';
import { isBetaAccessEnforced, isBetaRealtimeVoiceEnabled } from '@/lib/beta-entitlements';

const TICKET_TTL_MS = 60_000;

export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();

  try {
    const parsed = realtimeTicketRequestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: '实时语音参数无效' }, { status: 400 });
    if (isBetaAccessEnforced() && !isBetaRealtimeVoiceEnabled()) {
      return NextResponse.json({
        error: '内测期间实时语音暂未开放，请使用文字或标准语音模式',
        code: 'BETA_REALTIME_VOICE_DISABLED',
      }, { status: 503 });
    }

    const sessionId = parsed.data.sessionId;
    const { data: session } = await auth.client
      .from('interview_sessions')
      .select('id, status')
      .eq('id', sessionId)
      .eq('user_id', auth.user.id)
      .maybeSingle();
    if (!session) return NextResponse.json({ error: '面试会话不存在' }, { status: 404 });
    if (session.status !== 'in_progress') return NextResponse.json({ error: '面试会话已结束' }, { status: 409 });

    const rawTicket = randomBytes(32).toString('base64url');
    const ticketHash = createHash('sha256').update(rawTicket).digest('hex');
    const expiresAt = new Date(Date.now() + TICKET_TTL_MS).toISOString();
    const { error } = await auth.client.from('interview_realtime_tickets').insert({
      ticket_hash: ticketHash,
      user_id: auth.user.id,
      session_id: sessionId,
      capability: parsed.data.capability,
      expires_at: expiresAt,
    });
    if (error) {
      console.error('[Interview realtime ticket] insert failed:', error.message);
      return NextResponse.json({ error: '实时语音服务暂不可用' }, { status: 503 });
    }
    return NextResponse.json({ ticket: rawTicket, capability: parsed.data.capability, expiresAt });
  } catch {
    return NextResponse.json({ error: '实时语音服务暂不可用' }, { status: 500 });
  }
}
