import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { recognizeWithAlibaba } from '@/lib/asr-provider';
import {
  countTextCharacters,
  createAiUsageRequestId,
  recordAiUsageError,
  recordAiUsageEvent,
} from '@/lib/ai-usage';
import { betaEntitlementResponse } from '@/lib/beta-entitlements';
import { reserveCredits, settleCredits } from '@/lib/credits';
import { parseInterviewVoiceRoute, resolveInterviewVoiceRoute } from '@/lib/interview-voice-routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { audioBase64, audioMimeType, sessionId } = body;

    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    if (!audioBase64 || typeof audioBase64 !== 'string' || audioBase64.length > 8_000_000) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const parsedSessionId = Number(sessionId);
    if (!Number.isInteger(parsedSessionId) || parsedSessionId <= 0) {
      return NextResponse.json({ error: '面试会话参数无效' }, { status: 400 });
    }
    const { data: session, error: sessionError } = await auth.client
      .from('interview_sessions')
      .select('id, status, language, voice_route, job_id')
      .eq('id', parsedSessionId)
      .eq('user_id', auth.user.id)
      .maybeSingle();
    if (sessionError) throw new Error(sessionError.message);
    if (!session) return NextResponse.json({ error: '无权访问该面试会话' }, { status: 403 });
    if (session.status !== 'in_progress') return NextResponse.json({ error: '面试会话已结束' }, { status: 409 });

    let voiceRoute = parseInterviewVoiceRoute(session.voice_route);
    if (!voiceRoute && session.job_id) {
      const { data: job } = await auth.client.from('jobs').select('region').eq('id', session.job_id).maybeSingle();
      voiceRoute = resolveInterviewVoiceRoute(job?.region);
    }
    voiceRoute ||= resolveInterviewVoiceRoute(null);
    if (voiceRoute.asrProvider === 'cartesia_ink') {
      return NextResponse.json({
        error: '海外岗位的语音识别仅使用 Cartesia Ink-2。实时连接暂不可用，请重新开始本次回答。',
        code: 'OVERSEAS_REALTIME_ASR_REQUIRED',
      }, { status: 503 });
    }

    const requestId = createAiUsageRequestId();
    const startedAt = Date.now();
    const audioPayload = audioBase64.includes(',') ? audioBase64.split(',').at(-1) || '' : audioBase64;
    const estimatedMinutes = Math.max(1 / 60, Math.min(5, Buffer.byteLength(audioPayload, 'base64') / 32_000 / 60));
    const reservation = await reserveCredits({
      userId: auth.user.id,
      metric: 'asr_minutes',
      units: estimatedMinutes,
      idempotencyKey: requestId,
      metadata: { feature: 'interview_asr', session_id: parsedSessionId },
    });

    try {
      const result = await recognizeWithAlibaba({
        audioBase64,
        audioMimeType,
        language: session.language === 'en' ? 'en' : undefined,
      });
      await recordAiUsageEvent({
        userId: auth.user.id,
        feature: 'interview_asr',
        provider: 'alibaba',
        modality: 'audio',
        model: result.usage.model,
        requestId,
        usageSource: result.usage.usageSource,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        inputAudioSeconds: result.usage.inputAudioSeconds,
        inputAudioBytes: result.audioBytes,
        audioTokens: result.usage.audioTokens,
        textCharacters: countTextCharacters(result.text),
        billingUnit: result.usage.inputAudioSeconds !== null ? 'audio_seconds' : null,
        billingUnits: result.usage.inputAudioSeconds,
        measurementSource: result.usage.inputAudioSeconds !== null ? 'provider' : 'request',
        interviewSessionId: parsedSessionId,
        metadata: { provider_request_id: result.usage.requestId, audio_mime_type: audioMimeType || null },
        durationMs: Date.now() - startedAt,
      });
      await settleCredits(reservation, 'committed');

      return NextResponse.json({ text: result.text, silence: false });
    } catch (error) {
      await settleCredits(reservation, 'released');
      await recordAiUsageError({
        userId: auth.user.id,
        feature: 'interview_asr',
        provider: 'alibaba',
        modality: 'audio',
        model: process.env.ALIBABA_ASR_MODEL?.trim() || 'qwen3-asr-flash',
        requestId,
        usageSource: 'unknown',
        measurementSource: 'request',
        interviewSessionId: parsedSessionId,
        metadata: { audio_base64_length: audioBase64.length, audio_mime_type: audioMimeType || null },
        durationMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }
  } catch (error) {
    const betaResponse = betaEntitlementResponse(error);
    if (betaResponse) return betaResponse;
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
