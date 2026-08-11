import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

export const INTERVIEW_ASR_WS_PATH = '/ws/interview/asr';

export class RealtimeASRProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RealtimeASRProviderConfigError';
  }
}

function normalizeLanguage(language?: string): string | undefined {
  const value = language?.trim().toLowerCase();
  return value && /^[a-z]{2,3}$/.test(value) ? value : undefined;
}

function getRealtimeEndpoint(): string {
  const configured = process.env.ALIBABA_ASR_REALTIME_URL?.trim();
  const workspaceId = process.env.ALIBABA_ASR_WORKSPACE_ID?.trim();
  const region = process.env.ALIBABA_ASR_REALTIME_REGION?.trim() || 'cn-beijing';
  const model = process.env.ALIBABA_ASR_REALTIME_MODEL?.trim() || 'qwen3-asr-flash-realtime';

  let rawUrl = configured;
  if (!rawUrl && workspaceId) {
    rawUrl = `wss://${workspaceId}.${region}.maas.aliyuncs.com/api-ws/v1/realtime`;
  }
  if (!rawUrl) {
    throw new RealtimeASRProviderConfigError(
      '实时 ASR 未配置，请设置 ALIBABA_ASR_REALTIME_URL 或 ALIBABA_ASR_WORKSPACE_ID',
    );
  }

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') throw new Error('invalid protocol');
    if (!url.searchParams.has('model')) url.searchParams.set('model', model);
    if (process.env.ALIBABA_ASR_REALTIME_HEARTBEAT !== 'false') {
      url.searchParams.set('heartbeat', 'true');
    }
    return url.toString();
  } catch {
    throw new RealtimeASRProviderConfigError(
      'ALIBABA_ASR_REALTIME_URL 配置无效，请设置完整的 ws(s) 地址',
    );
  }
}

export function createAlibabaRealtimeASRSocket(): WebSocket {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) {
    throw new RealtimeASRProviderConfigError('实时 ASR 未配置，请设置 DASHSCOPE_API_KEY');
  }

  const timeoutMs = Number(process.env.ALIBABA_ASR_REALTIME_TIMEOUT_MS?.trim() || '15000');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5000 || timeoutMs > 120000) {
    throw new RealtimeASRProviderConfigError(
      'ALIBABA_ASR_REALTIME_TIMEOUT_MS 配置无效，请设置为 5000 到 120000 之间的整数（毫秒）',
    );
  }

  return new WebSocket(getRealtimeEndpoint(), {
    handshakeTimeout: timeoutMs,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'OpenAI-Beta': 'realtime=v1',
    },
  });
}

export function createRealtimeEventId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

export function buildRealtimeSessionUpdate(language?: string): string {
  const normalizedLanguage = normalizeLanguage(language);
  return JSON.stringify({
    type: 'session.update',
    event_id: createRealtimeEventId('event'),
    session: {
      input_audio_format: 'pcm',
      sample_rate: 16000,
      input_audio_transcription: normalizedLanguage
        ? { language: normalizedLanguage }
        : {},
      turn_detection: {
        type: 'server_vad',
        threshold: 0.2,
        silence_duration_ms: 400,
      },
    },
  });
}

export function buildRealtimeAudioAppend(audio: Buffer): string {
  return JSON.stringify({
    type: 'input_audio_buffer.append',
    event_id: createRealtimeEventId('audio'),
    audio: audio.toString('base64'),
  });
}

export function buildRealtimeSessionFinish(): string {
  return JSON.stringify({
    type: 'session.finish',
    event_id: createRealtimeEventId('event'),
  });
}
