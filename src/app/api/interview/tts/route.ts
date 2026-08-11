import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { createTTSProviderClient } from '@/lib/tts-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, language, speaker, speechRate, loudnessRate } = body;

    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const ttsClient = createTTSProviderClient({ requestHeaders: request.headers });
    const result = await ttsClient.synthesize({
      text,
      language,
      speaker,
      speechRate,
      userId: auth.user.id,
    });

    return new NextResponse(result.audio, {
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('TTS error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '语音合成失败' },
      { status: 500 }
    );
  }
}
