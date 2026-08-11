import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { recognizeWithAlibaba } from '@/lib/asr-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { audioBase64, audioMimeType, language } = body;

    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    if (!audioBase64 || typeof audioBase64 !== 'string' || audioBase64.length > 8_000_000) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const result = await recognizeWithAlibaba({
      audioBase64,
      audioMimeType,
      language: language === 'en' ? 'en' : undefined,
    });

    return NextResponse.json({ text: result.text, silence: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : '语音识别失败';
    const isSilence =
      message.includes('no valid speech') ||
      message.includes('silence') ||
      message.includes('20000003') ||
      message.includes('empty audio') ||
      message.includes('invalid argument');
    if (isSilence) return NextResponse.json({ text: '', silence: true });
    console.error('ASR error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
