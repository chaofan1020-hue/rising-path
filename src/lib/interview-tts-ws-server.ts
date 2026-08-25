import type { IncomingMessage, Server } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import {
  getCartesiaVoiceId,
  normalizeSpeechRate,
} from '@/lib/tts-provider';
import {
  countTextCharacters,
  estimatePcmDurationSeconds,
  recordAiUsageEvent,
} from '@/lib/ai-usage';
import { reserveCredits, settleCreditsActual, type CreditReservation } from '@/lib/credits';
import {
  getEffectiveInterviewTTSProvider,
  parseInterviewVoiceRoute,
  resolveInterviewVoiceRoute,
  type InterviewVoiceRoute,
} from '@/lib/interview-voice-routing';
import WebSocket, { WebSocketServer } from 'ws';

const TTS_WS_PATH = '/ws/interview/tts';
const CLIENT_PROTOCOL = 'rising-path-tts-v1';
const AUTH_PROTOCOL_PREFIX = 'rising-path-auth.';
const MAX_CONNECTION_MS = Number(process.env.INTERVIEW_REALTIME_CONNECTION_MAX_MS || 30 * 60 * 1000);
const IDLE_TIMEOUT_MS = 60 * 1000;
const UPSTREAM_IDLE_CLOSE_MS = Number(process.env.CARTESIA_TTS_IDLE_CLOSE_MS || 10_000);
const MAX_ACTIVE_CONNECTIONS = 50;
let activeConnections = 0;

interface CartesiaEvent {
  type?: string;
  data?: string;
  done?: boolean;
  message?: string;
  context_id?: string;
}

function sendJSON(socket: WebSocket, value: Record<string, unknown>): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function rejectUpgrade(socket: import('node:stream').Duplex, status: number, message: string): void {
  const statusText = status === 429 ? 'Too Many Requests' : status === 401 ? 'Unauthorized' : 'Bad Request';
  socket.write(`HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\n\r\n${message}`);
  socket.destroy();
}

function getProtocols(request: IncomingMessage): string[] {
  const header = request.headers['sec-websocket-protocol'];
  return header ? header.split(',').map((value) => value.trim()).filter(Boolean) : [];
}

function getTicket(request: IncomingMessage): string | null {
  const authProtocol = getProtocols(request).find((protocol) => protocol.startsWith(AUTH_PROTOCOL_PREFIX));
  return authProtocol?.slice(AUTH_PROTOCOL_PREFIX.length).trim() || null;
}

interface AuthenticatedTtsSession {
  userId: string;
  sessionId: number;
  language: 'zh' | 'en';
  voiceRoute: InterviewVoiceRoute;
}

async function authenticateTicket(ticket: string): Promise<AuthenticatedTtsSession | null> {
  try {
    const ticketHash = createHash('sha256').update(ticket).digest('hex');
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('interview_realtime_tickets')
      .select('id, user_id, session_id')
      .eq('ticket_hash', ticketHash)
      .eq('capability', 'tts')
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error || !data) return null;
    if (!data.session_id) return null;
    const { data: session } = await client
      .from('interview_sessions')
      .select('id, status, language, voice_route, job_id')
      .eq('id', data.session_id)
      .eq('user_id', data.user_id)
      .maybeSingle();
    if (!session || session.status !== 'in_progress') return null;
    const { data: claimed } = await client
      .from('interview_realtime_tickets')
      .update({ used_at: new Date().toISOString() })
      .eq('id', data.id)
      .is('used_at', null)
      .select('user_id, session_id')
      .maybeSingle();
    if (!claimed?.user_id || !claimed.session_id) return null;
    let voiceRoute = parseInterviewVoiceRoute(session.voice_route);
    if (!voiceRoute && session.job_id) {
      const { data: job } = await client.from('jobs').select('region').eq('id', session.job_id).maybeSingle();
      voiceRoute = resolveInterviewVoiceRoute(job?.region);
    }
    return {
      userId: claimed.user_id,
      sessionId: Number(claimed.session_id),
      language: session.language === 'en' ? 'en' : 'zh',
      voiceRoute: voiceRoute || resolveInterviewVoiceRoute(null),
    };
  } catch (error) {
    console.error('[Interview TTS WS] Supabase authentication failed:', error);
    return null;
  }
}

async function ownsInterviewSession(userId: string, sessionId: unknown): Promise<number | null> {
  if (sessionId === undefined || sessionId === null || sessionId === '') return null;
  const parsed = Number(sessionId);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  try {
    const { data, error } = await getSupabaseClient()
      .from('interview_sessions')
      .select('id, status')
      .eq('id', parsed)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      console.error('[Interview TTS WS] Session ownership check failed:', error.message);
      return null;
    }
    return data?.status === 'in_progress' ? parsed : null;
  } catch (error) {
    console.error('[Interview TTS WS] Session ownership check failed:', error);
    return null;
  }
}

function getCartesiaEndpoint(): string {
  const baseUrl = process.env.CARTESIA_BASE_URL?.trim() || 'https://api.cartesia.ai';
  const version = process.env.CARTESIA_VERSION?.trim() || '2026-03-01';
  const url = new URL(baseUrl);
  url.protocol = 'wss:';
  url.pathname = '/tts/websocket';
  url.search = '';
  url.searchParams.set('cartesia_version', version);
  return url.toString();
}

function createCartesiaSocket(): WebSocket {
  const apiKey = process.env.CARTESIA_API_KEY?.trim();
  if (!apiKey) throw new Error('Cartesia TTS 未配置，请设置 CARTESIA_API_KEY');
  return new WebSocket(getCartesiaEndpoint(), {
    handshakeTimeout: 15000,
    headers: { 'X-API-Key': apiKey },
  });
}

interface ActiveTtsRequest {
  requestId: string;
  contextId: string;
  outputAudioBytes: number;
  textCharacters: number;
  startedAt: number;
  firstAudioAt: number | null;
  settled: boolean;
  creditReservation: CreditReservation | null;
}

function isClientRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{8,80}$/.test(value);
}

function handleConnection(client: WebSocket, auth: AuthenticatedTtsSession): void {
  const { userId, sessionId: ticketSessionId, language: sessionLanguage, voiceRoute } = auth;
  const ttsRoute = getEffectiveInterviewTTSProvider(voiceRoute);
  activeConnections += 1;
  let activeRequest: ActiveTtsRequest | null = null;
  let cartesia: WebSocket | null = null;
  let cartesiaOpening: Promise<WebSocket> | null = null;
  let upstreamIdleTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const connectionTimer = setTimeout(() => client.close(1008, 'TTS connection time limit'), MAX_CONNECTION_MS);
  const touch = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => client.close(1000, 'TTS connection idle timeout'), IDLE_TIMEOUT_MS);
  };
  touch();

  const clearUpstream = () => {
    if (upstreamIdleTimer) {
      clearTimeout(upstreamIdleTimer);
      upstreamIdleTimer = null;
    }
    cartesia = null;
    cartesiaOpening = null;
  };

  const scheduleUpstreamClose = () => {
    if (upstreamIdleTimer) clearTimeout(upstreamIdleTimer);
    upstreamIdleTimer = setTimeout(() => {
      upstreamIdleTimer = null;
      if (!activeRequest && cartesia) {
        if (cartesia.readyState === WebSocket.OPEN) cartesia.close(1000, 'TTS upstream idle');
        else cartesia.terminate();
        clearUpstream();
      }
    }, Number.isFinite(UPSTREAM_IDLE_CLOSE_MS) && UPSTREAM_IDLE_CLOSE_MS >= 2_000 ? UPSTREAM_IDLE_CLOSE_MS : 10_000);
  };

  const settleRequest = (request: ActiveTtsRequest, status: 'success' | 'error', type: 'done' | 'cancelled' | 'error', error?: string) => {
    if (request.settled) return;
    request.settled = true;
    if (activeRequest === request) activeRequest = null;
    if (type === 'error') sendJSON(client, { type, requestId: request.requestId, error: error || 'Cartesia TTS 生成失败' });
    else sendJSON(client, { type, requestId: request.requestId, sampleRate: 44100 });
    void recordUsage(request, status, error || null);
    scheduleUpstreamClose();
  };

  const handleUpstreamMessage = (message: WebSocket.RawData) => {
    touch();
    let event: CartesiaEvent;
    try {
      event = JSON.parse(message.toString()) as CartesiaEvent;
    } catch {
      if (activeRequest) settleRequest(activeRequest, 'error', 'error', 'Cartesia 返回了无法解析的事件');
      return;
    }
    const request = activeRequest;
    // Cartesia multiplexes contexts. A cancelled context can still flush audio,
    // so only forward events belonging to the current candidate-visible request.
    if (!request || event.context_id !== request.contextId || request.settled) return;
    if (event.type === 'chunk' && typeof event.data === 'string') {
      const audio = Buffer.from(event.data, 'base64');
      if (audio.byteLength > 0 && request.firstAudioAt === null) request.firstAudioAt = Date.now();
      request.outputAudioBytes += audio.byteLength;
      if (client.readyState === WebSocket.OPEN) client.send(audio);
    } else if (event.type === 'done' || event.done === true) {
      settleRequest(request, 'success', 'done');
    } else if (event.type === 'error') {
      settleRequest(request, 'error', 'error', event.message || 'Cartesia TTS 生成失败');
    }
  };

  const ensureCartesia = (): Promise<WebSocket> => {
    if (cartesia?.readyState === WebSocket.OPEN) return Promise.resolve(cartesia);
    if (cartesiaOpening) return cartesiaOpening;
    const upstream = createCartesiaSocket();
    cartesiaOpening = new Promise<WebSocket>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearUpstream();
        try { upstream.terminate(); } catch { /* socket may already be closed */ }
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error('Cartesia TTS 连接超时')), 15_000);
      upstream.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cartesia = upstream;
        cartesiaOpening = null;
        resolve(upstream);
      });
      upstream.on('message', handleUpstreamMessage);
      upstream.on('error', (error) => {
        console.error('[Interview TTS WS] Cartesia connection failed:', error.message);
        if (!settled) fail(error);
        else if (activeRequest) settleRequest(activeRequest, 'error', 'error', 'Cartesia TTS 连接失败');
      });
      upstream.on('close', () => {
        const wasOpening = !settled;
        clearUpstream();
        if (wasOpening) fail(new Error('Cartesia TTS 连接已关闭'));
        else if (activeRequest) settleRequest(activeRequest, 'error', 'error', 'Cartesia TTS 连接已关闭');
      });
    });
    return cartesiaOpening;
  };

  const recordUsage = async (request: ActiveTtsRequest, status: 'success' | 'error', errorMessage: string | null = null) => {
    const outputAudioSeconds = estimatePcmDurationSeconds(request.outputAudioBytes, 44100, 1, 16);
    await recordAiUsageEvent({
      userId,
      feature: 'interview_tts_realtime',
      provider: ttsRoute.provider === 'cartesia_sonic' ? 'cartesia' : 'alibaba',
      modality: 'audio',
      model: ttsRoute.provider === 'cartesia_sonic'
        ? process.env.CARTESIA_MODEL?.trim() || 'sonic-3.5'
        : process.env.ALIBABA_TTS_MODEL?.trim() || 'unconfigured',
      requestId: request.requestId,
      status,
      usageSource: outputAudioSeconds !== null ? 'actual' : 'unknown',
      outputAudioSeconds,
      outputAudioBytes: request.outputAudioBytes,
      textCharacters: request.textCharacters,
      billingUnit: outputAudioSeconds !== null ? 'audio_seconds' : null,
      billingUnits: outputAudioSeconds,
      measurementSource: outputAudioSeconds !== null ? 'pcm_exact' : 'unknown',
      interviewSessionId: ticketSessionId,
      metadata: {
        audio_format: 'pcm_s16le',
        sample_rate: 44100,
        channels: 1,
        client_request_id: request.requestId,
        voice_route: voiceRoute.id,
        configured_tts_provider: voiceRoute.ttsProvider,
        fallback_reason: ttsRoute.fallbackReason,
      },
      durationMs: Date.now() - request.startedAt,
      totalMs: Date.now() - request.startedAt,
      ttfbMs: request.firstAudioAt === null ? null : request.firstAudioAt - request.startedAt,
      phase: 'interviewer_playback',
      errorMessage,
    });
    await settleCreditsActual(
      request.creditReservation,
      status === 'success' && outputAudioSeconds !== null ? outputAudioSeconds / 60 : 0,
      status === 'success' ? 'committed' : 'released',
      status === 'success' ? `语音合成 ${outputAudioSeconds?.toFixed(1) || '0.0'} 秒，按实际时长结算` : '语音合成失败，已退回预留积分',
    );
    request.creditReservation = null;
  };

  client.on('message', async (raw, isBinary) => {
    touch();
    if (isBinary) return;
    let request: {
      type?: string;
      text?: string;
      language?: string;
      speaker?: string;
      speechRate?: number;
      sessionId?: number | string | null;
      requestId?: string;
    };
    try {
      request = JSON.parse(raw.toString()) as typeof request;
    } catch {
      sendJSON(client, { type: 'error', error: 'TTS 请求格式错误' });
      return;
    }
    if (request.type === 'cancel') {
      if (!activeRequest) return;
      if (request.requestId && request.requestId !== activeRequest.requestId) return;
      if (cartesia?.readyState === WebSocket.OPEN) {
        cartesia.send(JSON.stringify({ context_id: activeRequest.contextId, cancel: true }));
      }
      settleRequest(activeRequest, 'success', 'cancelled');
      return;
    }
    if (request.type === 'ping') return;
    if (request.type !== 'speak' || !request.text?.trim()) return;
    if (ttsRoute.provider === 'alibaba') {
      sendJSON(client, {
        type: 'error',
        requestId: request.requestId,
        error: '阿里云实时 TTS 尚未完成服务端配置，已拒绝本次播放以避免使用错误的供应商',
      });
      return;
    }
    if (!isClientRequestId(request.requestId)) {
      sendJSON(client, { type: 'error', error: 'TTS requestId 无效' });
      return;
    }
    if (activeRequest) {
      sendJSON(client, { type: 'error', requestId: request.requestId, error: '上一段语音仍在生成' });
      return;
    }
    if (request.text.length > 2_000) {
      sendJSON(client, { type: 'error', requestId: request.requestId, error: 'TTS 文本不能超过 2000 字符' });
      return;
    }

    const requestedSessionId = Number(request.sessionId);
    if (!Number.isInteger(requestedSessionId) || requestedSessionId !== ticketSessionId) {
      sendJSON(client, { type: 'error', requestId: request.requestId, error: '实时 TTS 会话不匹配' });
      client.close(1008, 'Realtime TTS session mismatch');
      return;
    }
    let reservation: CreditReservation | null = null;
    try {
      reservation = await reserveCredits({
        userId,
        metric: 'tts_minutes',
        units: Math.max(1 / 60, Math.min(5, request.text.length / 12 / 60)),
        idempotencyKey: request.requestId,
        metadata: { feature: 'interview_tts_realtime', session_id: ticketSessionId },
      });
    } catch (error) {
      sendJSON(client, { type: 'error', requestId: request.requestId, error: error instanceof Error ? error.message : '实时 TTS 积分不足' });
      return;
    }
    const active: ActiveTtsRequest = {
      requestId: request.requestId,
      contextId: randomUUID(),
      outputAudioBytes: 0,
      textCharacters: countTextCharacters(request.text.slice(0, 2000)),
      startedAt: Date.now(),
      firstAudioAt: null,
      settled: false,
      creditReservation: reservation,
    };
    activeRequest = active;

    const requestedLanguage = request.language?.trim().toLowerCase();
    if (requestedLanguage && requestedLanguage !== sessionLanguage) {
      settleRequest(active, 'error', 'error', '实时 TTS 语言与面试会话不一致');
      return;
    }
    try {
      const upstream = await ensureCartesia();
      if (active.settled || upstream.readyState !== WebSocket.OPEN) return;
      upstream.send(JSON.stringify({
        model_id: process.env.CARTESIA_MODEL?.trim() || 'sonic-3.5',
        transcript: request.text!.slice(0, 2000),
        voice: { mode: 'id', id: getCartesiaVoiceId(sessionLanguage, request.speaker) },
        language: sessionLanguage,
        context_id: active.contextId,
        output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 44100 },
        generation_config: { speed: normalizeSpeechRate(request.speechRate) },
        continue: false,
      }));
    } catch (error) {
      settleRequest(active, 'error', 'error', error instanceof Error ? error.message : 'Cartesia TTS 配置错误');
    }
  });

  client.on('close', () => {
    clearTimeout(connectionTimer);
    if (idleTimer) clearTimeout(idleTimer);
    activeConnections = Math.max(0, activeConnections - 1);
    if (activeRequest) settleRequest(activeRequest, 'error', 'error', 'TTS 客户端连接已关闭');
    if (cartesia?.readyState === WebSocket.OPEN) cartesia.close(1000);
    else cartesia?.terminate();
    clearUpstream();
  });
  client.on('error', (error) => {
    if (activeRequest) settleRequest(activeRequest, 'error', 'error', error instanceof Error ? error.message : 'TTS 客户端连接失败');
  });

}

export function attachInterviewTTSWebSocket(server: Server): (request: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => void {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    handleProtocols: (protocols) => protocols.has(CLIENT_PROTOCOL) ? CLIENT_PROTOCOL : '',
  });

  const handleUpgrade = (request: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
    const requestUrl = new URL(request.url || '/', 'http://localhost');
    if (requestUrl.pathname !== TTS_WS_PATH) return;
    const protocols = getProtocols(request);
    const ticket = getTicket(request);
    if (!protocols.includes(CLIENT_PROTOCOL) || !ticket) {
      rejectUpgrade(socket, 401, 'Missing realtime TTS authentication');
      return;
    }
    void authenticateTicket(ticket).then((auth) => {
      if (!auth) {
        rejectUpgrade(socket, 401, 'Invalid realtime TTS authentication');
        return;
      }
      if (activeConnections >= MAX_ACTIVE_CONNECTIONS) {
        rejectUpgrade(socket, 429, 'Realtime TTS capacity reached');
        return;
      }
      wss.handleUpgrade(request, socket, head, (client) => handleConnection(client, auth));
    }).catch((error) => {
      console.error('[Interview TTS WS] Upgrade failed:', error);
      rejectUpgrade(socket, 401, 'Realtime TTS authentication failed');
    });
  };
  server.on('upgrade', handleUpgrade);
  return handleUpgrade;
}
