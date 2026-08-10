import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { createVoiceProvider } from '@/lib/voice-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { audioBase64, language } = body;

    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    if (!audioBase64 || typeof audioBase64 !== 'string' || audioBase64.length > 8_000_000) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const provider = createVoiceProvider(Object.fromEntries(request.headers.entries()));
    const result = await provider.transcribe({
      audioBase64,
      language,
      uid: `interview_${auth.user.id}`,
    });

    return NextResponse.json({ text: result.text, silence: result.silence ?? false });
  } catch (error) {
    const message = error instanceof Error ? error.message : '语音识别失败';
    console.error('ASR error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
