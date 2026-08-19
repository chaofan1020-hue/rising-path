import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { createTTSProviderClient } from '@/lib/tts-provider';
import {
  countTextCharacters,
  createAiUsageRequestId,
  estimateMp3DurationSeconds,
  recordAiUsageError,
  recordAiUsageEvent,
} from '@/lib/ai-usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, speaker, speechRate, loudnessRate, sessionId } = body;

    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const parsedSessionId = Number(sessionId);
    if (!Number.isInteger(parsedSessionId) || parsedSessionId <= 0) {
      return NextResponse.json({ error: '面试会话参数无效' }, { status: 400 });
    }
    const { data: session, error: sessionError } = await auth.client
      .from('interview_sessions')
      .select('id, status, language')
      .eq('id', parsedSessionId)
      .eq('user_id', auth.user.id)
      .maybeSingle();
    if (sessionError) throw new Error(sessionError.message);
    if (!session) return NextResponse.json({ error: '无权访问该面试会话' }, { status: 403 });
    if (session.status !== 'in_progress') {
      return NextResponse.json({ error: '面试会话已结束' }, { status: 409 });
    }

    const requestId = createAiUsageRequestId();
    const startedAt = Date.now();
    try {
      const ttsClient = createTTSProviderClient({ requestHeaders: request.headers });
      const result = await ttsClient.synthesize({
        text,
        language: session.language === 'en' ? 'en' : 'zh',
        speaker,
        speechRate,
        userId: auth.user.id,
      });
      const outputBytes = result.audio.byteLength;
      const outputAudioSeconds = estimateMp3DurationSeconds(outputBytes);
      await recordAiUsageEvent({
        userId: auth.user.id,
        feature: 'interview_tts',
        provider: result.provider,
        modality: 'audio',
        model: result.model,
        requestId,
        usageSource: 'estimated',
        outputAudioSeconds,
        outputAudioBytes: outputBytes,
        textCharacters: countTextCharacters(text.slice(0, 1000)),
        billingUnit: 'audio_seconds',
        billingUnits: outputAudioSeconds,
        measurementSource: 'container_estimated',
        interviewSessionId: parsedSessionId,
        metadata: {
          provider_request_id: result.requestId,
          content_type: result.contentType,
          bitrate: 128000,
        },
        durationMs: Date.now() - startedAt,
        totalMs: Date.now() - startedAt,
        phase: 'interviewer_playback_fallback',
        fallback: true,
      });

      return new NextResponse(result.audio, {
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': 'no-store',
      },
      });
    } catch (error) {
      await recordAiUsageError({
        userId: auth.user.id,
        feature: 'interview_tts',
        provider: 'cartesia',
        modality: 'audio',
        model: process.env.CARTESIA_MODEL?.trim() || 'sonic-3.5',
        requestId,
        usageSource: 'unknown',
        textCharacters: countTextCharacters(text.slice(0, 1000)),
        measurementSource: 'request',
        interviewSessionId: parsedSessionId,
        durationMs: Date.now() - startedAt,
        totalMs: Date.now() - startedAt,
        phase: 'interviewer_playback_fallback',
        fallback: true,
        error,
      });
      throw error;
    }
  } catch (error) {
    console.error('TTS error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '语音合成失败' },
      { status: 500 }
    );
  }
}
