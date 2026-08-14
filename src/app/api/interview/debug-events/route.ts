import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

const debugEventSchema = z.object({
  traceId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  sessionId: z.number().int().positive().nullable(),
  event: z.string().regex(/^[a-z0-9._-]{3,80}$/),
  at: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

function debugEnabled(): boolean {
  return process.env.INTERVIEW_DEBUG_LOGGING === 'true';
}

export async function POST(request: NextRequest) {
  if (!debugEnabled()) return NextResponse.json({ error: 'debug logging disabled' }, { status: 404 });
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();

  try {
    const parsed = debugEventSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'invalid debug event' }, { status: 400 });
    const event = parsed.data;
    if (event.sessionId) {
      const { data: session } = await auth.client
        .from('interview_sessions')
        .select('id')
        .eq('id', event.sessionId)
        .eq('user_id', auth.user.id)
        .maybeSingle();
      if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 });
    }

    // Test-only timeline. Keep it in process output rather than the product
    // database and never accept audio payloads or credentials from the client.
    console.info('[InterviewDebug]', JSON.stringify({
      traceId: event.traceId,
      sessionId: event.sessionId,
      userId: auth.user.id,
      event: event.event,
      at: event.at,
      payload: event.payload ?? {},
    }));
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: 'debug event unavailable' }, { status: 500 });
  }
}
