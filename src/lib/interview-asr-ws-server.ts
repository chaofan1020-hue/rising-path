import type { IncomingMessage, Server } from 'node:http';
import { createHash } from 'node:crypto';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import WebSocket, { WebSocketServer } from 'ws';
import {
  countTextCharacters,
  createAiUsageRequestId,
  estimatePcmDurationSeconds,
  recordAiUsageEvent,
} from '@/lib/ai-usage';
import { reserveCredits, settleCreditsActual, type CreditReservation } from '@/lib/credits';
import {
  INTERVIEW_ASR_WS_PATH,
  buildRealtimeAudioAppend,
  buildRealtimeSessionFinish,
  buildRealtimeSessionUpdate,
  createAlibabaRealtimeASRSocket,
  createRealtimeEventId,
} from '@/lib/asr-realtime-provider';
import {
  buildCartesiaInkClose,
  buildCartesiaInkConfig,
  createCartesiaInkSocket,
  getCartesiaInkIdleCloseMs,
  getCartesiaInkModel,
} from '@/lib/cartesia-realtime-asr-provider';
import {
  parseInterviewVoiceRoute,
  resolveInterviewVoiceRoute,
  type InterviewASRProvider,
  type InterviewVoiceRoute,
} from '@/lib/interview-voice-routing';

const CLIENT_PROTOCOL = 'rising-path-asr-v1';
const AUTH_PROTOCOL_PREFIX = 'rising-path-auth.';
const MAX_QUEUED_AUDIO_BYTES = 1024 * 1024;
const MAX_AUDIO_BYTES_PER_CONNECTION = 64 * 1024 * 1024;
const MAX_CONNECTION_MS = Number(process.env.INTERVIEW_REALTIME_CONNECTION_MAX_MS || 30 * 60 * 1000);
const ASR_CREDIT_BLOCK_MINUTES = 0.25;
const IDLE_TIMEOUT_MS = 60 * 1000;
const MAX_ACTIVE_CONNECTIONS = 50;
// Cartesia recommends approximately 100 ms PCM messages. Smaller chunks also
// prevent the initial VAD prebuffer from arriving as one large burst.
const CARTESIA_PCM_CHUNK_BYTES = 3_200;
let activeConnections = 0;
let activeCartesiaInkStreams = 0;

interface AlibabaASREvent {
  type?: string;
  event_id?: string;
  item_id?: string;
  language?: string;
  emotion?: string;
  text?: string;
  stash?: string;
  transcript?: string;
  session?: { id?: string; [key: string]: unknown };
  usage?: { duration?: number };
  error?: { message?: string };
}

interface ClientStartMessage {
  type: 'start';
  language?: string;
  sessionId?: number | string | null;
}

interface UpstreamUtteranceState {
  sequence: number;
  activeId: string | null;
  itemIds: Map<string, string>;
}

interface AuthenticatedRealtimeSession {
  userId: string;
  sessionId: number;
  language: 'zh' | 'en';
  voiceRoute: InterviewVoiceRoute;
}

interface CartesiaInkEvent {
  type?: string;
  transcript?: string;
  request_id?: string;
  title?: string;
  message?: string;
  error_code?: string;
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
  if (!header) return [];
  return header.split(',').map((value) => value.trim()).filter(Boolean);
}

function getTicket(request: IncomingMessage): string | null {
  const authProtocol = getProtocols(request).find((protocol) => protocol.startsWith(AUTH_PROTOCOL_PREFIX));
  const token = authProtocol?.slice(AUTH_PROTOCOL_PREFIX.length).trim();
  return token || null;
}

async function authenticateTicket(ticket: string): Promise<AuthenticatedRealtimeSession | null> {
  try {
    const ticketHash = createHash('sha256').update(ticket).digest('hex');
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('interview_realtime_tickets')
      .select('id, user_id, session_id, capability, expires_at, used_at')
      .eq('ticket_hash', ticketHash)
      .eq('capability', 'asr')
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
      const { data: job } = await client
        .from('jobs')
        .select('region')
        .eq('id', session.job_id)
        .maybeSingle();
      voiceRoute = resolveInterviewVoiceRoute(job?.region);
    }
    return {
      userId: claimed.user_id,
      sessionId: Number(claimed.session_id),
      language: session.language === 'en' ? 'en' : 'zh',
      voiceRoute: voiceRoute || resolveInterviewVoiceRoute(null),
    };
  } catch (error) {
    console.error('[Interview ASR WS] Supabase authentication failed:', error);
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
      console.error('[Interview ASR WS] Session ownership check failed:', error.message);
      return null;
    }
    return data?.status === 'in_progress' ? parsed : null;
  } catch (error) {
    console.error('[Interview ASR WS] Session ownership check failed:', error);
    return null;
  }
}

function forwardAlibabaEvent(
  client: WebSocket,
  raw: WebSocket.RawData,
  utteranceState: UpstreamUtteranceState,
): void {
  let event: AlibabaASREvent;
  try {
    event = JSON.parse(raw.toString()) as AlibabaASREvent;
  } catch {
    sendJSON(client, { type: 'error', error: '实时 ASR 返回了无法解析的事件' });
    return;
  }

  switch (event.type) {
    case 'session.created':
      sendJSON(client, { type: 'session_created', sessionId: event.session?.id });
      return;
    case 'session.updated':
      sendJSON(client, { type: 'ready', session: event.session });
      return;
    case 'input_audio_buffer.speech_started': {
      const utteranceId = `utterance_${++utteranceState.sequence}`;
      utteranceState.activeId = utteranceId;
      sendJSON(client, { type: 'speech_started', eventId: event.event_id, utteranceId });
      return;
    }
    case 'input_audio_buffer.speech_stopped':
      sendJSON(client, {
        type: 'speech_stopped',
        eventId: event.event_id,
        utteranceId: utteranceState.activeId,
      });
      return;
    case 'conversation.item.input_audio_transcription.text': {
      const utteranceId = event.item_id
        ? utteranceState.itemIds.get(event.item_id) || utteranceState.activeId
        : utteranceState.activeId;
      if (event.item_id && utteranceId) utteranceState.itemIds.set(event.item_id, utteranceId);
      sendJSON(client, {
        type: 'partial',
        itemId: event.item_id,
        utteranceId,
        // `stash` is an unstable hypothesis. The browser receives it as a
        // separate field and only renders the confirmed prefix.
        text: String(event.text || '').trim(),
        confirmedText: String(event.text || '').trim(),
        draftText: event.stash || '',
        language: event.language,
        emotion: event.emotion,
      });
      return;
    }
    case 'conversation.item.input_audio_transcription.completed': {
      const utteranceId = event.item_id
        ? utteranceState.itemIds.get(event.item_id) || null
        : utteranceState.activeId;
      sendJSON(client, {
        type: 'final',
        itemId: event.item_id,
        utteranceId,
        text: String(event.transcript || '').trim(),
        language: event.language,
        emotion: event.emotion,
      });
      if (event.item_id) utteranceState.itemIds.delete(event.item_id);
      return;
    }
    case 'conversation.item.input_audio_transcription.failed':
      sendJSON(client, {
        type: 'error',
        itemId: event.item_id,
        error: event.error?.message || '实时语音识别失败',
      });
      return;
    case 'error':
      sendJSON(client, { type: 'error', error: event.error?.message || '实时 ASR 请求失败' });
      return;
    case 'session.finished':
      sendJSON(client, { type: 'finished' });
      return;
    default:
      return;
  }
}

function readCartesiaInkMaxStreams(): number {
  const value = Number(process.env.CARTESIA_INK_MAX_ACTIVE_STREAMS?.trim());
  return Number.isInteger(value) && value >= 1 && value <= 1_000 ? value : 10;
}

function hasCartesiaSpeechEnergy(chunk: Buffer): boolean {
  // Do not reopen an Ink stream for the zeroed trailing frames and room-noise
  // prebuffer that the browser keeps locally between answers. These thresholds
  // are deliberately lower than speech VAD; Silero already confirmed speech
  // before meaningful audio reaches this server path.
  if (chunk.byteLength < 4) return false;
  let peak = 0;
  let sum = 0;
  const sampleCount = Math.floor(chunk.byteLength / 2);
  for (let index = 0; index < sampleCount; index += 1) {
    const value = Math.abs(chunk.readInt16LE(index * 2));
    peak = Math.max(peak, value);
    sum += value;
  }
  return peak >= 480 && sum / sampleCount >= 45;
}

function setupConnection(client: WebSocket, auth: AuthenticatedRealtimeSession): void {
  const { userId, sessionId: ticketSessionId, language: ticketLanguage, voiceRoute } = auth;
  activeConnections += 1;
  let upstream: WebSocket | null = null;
  let upstreamReady = false;
  let finishing = false;
  const language = ticketLanguage;
  let queuedAudio: Buffer[] = [];
  let queuedAudioBytes = 0;
  let audioBytes = 0;
  let started = false;
  let textCharacters = 0;
  let providerAudioSeconds: number | null = null;
  let upstreamSessionId: string | null = null;
  let interviewSessionId: number | null = null;
  let usageRecorded = false;
  const creditReservations: CreditReservation[] = [];
  let lastError: string | null = null;
  let cartesiaLastAudioAt = 0;
  let cartesiaAudioBytes = 0;
  let cartesiaIdleTimer: ReturnType<typeof setTimeout> | null = null;
  const releasedCartesiaStreams = new WeakSet<WebSocket>();
  const suppressedUpstreamCloses = new WeakSet<WebSocket>();
  const utteranceState: UpstreamUtteranceState = {
    sequence: 0,
    activeId: null,
    itemIds: new Map(),
  };
  const usageRequestId = createAiUsageRequestId();
  const startedAt = Date.now();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const connectionTimer = setTimeout(() => client.close(1008, 'ASR connection time limit'), MAX_CONNECTION_MS);
  const touch = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => client.close(1000, 'ASR connection idle timeout'), IDLE_TIMEOUT_MS);
  };
  touch();

  const releaseCartesiaSlot = (connection: WebSocket) => {
    if (voiceRoute.asrProvider !== 'cartesia_ink' || releasedCartesiaStreams.has(connection)) return;
    releasedCartesiaStreams.add(connection);
    activeCartesiaInkStreams = Math.max(0, activeCartesiaInkStreams - 1);
  };

  const closeUpstream = (suppressBrowserNotice = false) => {
    if (cartesiaIdleTimer) {
      clearTimeout(cartesiaIdleTimer);
      cartesiaIdleTimer = null;
    }
    const connection = upstream;
    if (!connection) return;
    if (suppressBrowserNotice) suppressedUpstreamCloses.add(connection);
    if (connection.readyState === WebSocket.OPEN) connection.close(1000);
    else if (connection.readyState === WebSocket.CONNECTING) connection.terminate();
    upstream = null;
    upstreamReady = false;
    releaseCartesiaSlot(connection);
  };

  const recordUsage = async (status: 'success' | 'error') => {
    if (usageRecorded || !started) return;
    usageRecorded = true;
    const inputAudioSeconds = providerAudioSeconds ?? estimatePcmDurationSeconds(audioBytes, 16000, 1, 16);
    await recordAiUsageEvent({
      userId,
      feature: 'interview_asr_realtime',
      provider: voiceRoute.asrProvider === 'cartesia_ink' ? 'cartesia' : 'alibaba',
      modality: 'audio',
      model: voiceRoute.asrProvider === 'cartesia_ink'
        ? getCartesiaInkModel()
        : process.env.ALIBABA_ASR_REALTIME_MODEL?.trim() || 'qwen3-asr-flash-realtime',
      requestId: usageRequestId,
      status,
      usageSource: providerAudioSeconds !== null ? 'actual' : inputAudioSeconds !== null ? 'estimated' : 'unknown',
      inputAudioSeconds,
      inputAudioBytes: audioBytes,
      textCharacters,
      billingUnit: inputAudioSeconds !== null ? 'audio_seconds' : null,
      billingUnits: inputAudioSeconds,
      measurementSource: providerAudioSeconds !== null ? 'provider' : inputAudioSeconds !== null ? 'pcm_exact' : 'unknown',
      interviewSessionId,
      metadata: {
        upstream_session_id: upstreamSessionId,
        audio_format: 'pcm_s16le',
        sample_rate: 16000,
        channels: 1,
        voice_route: voiceRoute.id,
        active_stream_count_at_close: activeCartesiaInkStreams,
        closed_reason: lastError ? 'error' : 'turn_complete_or_client_closed',
      },
      durationMs: Date.now() - startedAt,
      errorMessage: lastError,
    });
    const actualMinutes = status === 'success' && inputAudioSeconds !== null ? inputAudioSeconds / 60 : 0;
    await Promise.all(creditReservations.map((reservation, index) => settleCreditsActual(
      reservation,
      Math.max(0, Math.min(ASR_CREDIT_BLOCK_MINUTES, actualMinutes - index * ASR_CREDIT_BLOCK_MINUTES)),
      status === 'success' ? 'committed' : 'released',
      status === 'success' ? `语音识别 ${inputAudioSeconds?.toFixed(1) || '0.0'} 秒，按实际时长结算` : '语音识别失败，已退回预留积分',
    )));
    creditReservations.length = 0;
  };

  const sendAudio = (chunk: Buffer) => {
    if (!upstream || !upstreamReady || upstream.readyState !== WebSocket.OPEN) {
      if (voiceRoute.asrProvider === 'cartesia_ink' && !hasCartesiaSpeechEnergy(chunk)) {
        return;
      }
      if (queuedAudioBytes + chunk.byteLength <= MAX_QUEUED_AUDIO_BYTES) {
        queuedAudio.push(chunk);
        queuedAudioBytes += chunk.byteLength;
      }
      startUpstream();
      return;
    }
    if (voiceRoute.asrProvider === 'cartesia_ink') {
      cartesiaLastAudioAt = Date.now();
      cartesiaAudioBytes += chunk.byteLength;
      for (let offset = 0; offset < chunk.byteLength; offset += CARTESIA_PCM_CHUNK_BYTES) {
        upstream.send(chunk.subarray(offset, offset + CARTESIA_PCM_CHUNK_BYTES));
      }
      if (cartesiaIdleTimer) clearTimeout(cartesiaIdleTimer);
      cartesiaIdleTimer = setTimeout(() => {
        if (Date.now() - cartesiaLastAudioAt >= getCartesiaInkIdleCloseMs()) {
          lastError = 'Cartesia Ink stream idle timeout';
          closeUpstream(true);
        }
      }, getCartesiaInkIdleCloseMs());
      return;
    }
    upstream.send(buildRealtimeAudioAppend(chunk));
  };

  const flushAudio = () => {
    const pending = queuedAudio;
    queuedAudio = [];
    queuedAudioBytes = 0;
    pending.forEach(sendAudio);
  };

  const startUpstream = () => {
    if (upstream) return;
    if (voiceRoute.asrProvider === 'cartesia_ink') {
      if (language !== 'en') {
        lastError = 'Cartesia Ink-2 only supports English';
        sendJSON(client, { type: 'error', code: 'CARTESIA_INK_LANGUAGE_UNSUPPORTED', error: '海外岗位的 Ink-2 目前仅支持英文面试' });
        return;
      }
      if (activeCartesiaInkStreams >= readCartesiaInkMaxStreams()) {
        lastError = 'Cartesia Ink concurrency capacity reached';
        sendJSON(client, {
          type: 'error',
          code: 'CARTESIA_INK_CAPACITY',
          error: '海外语音识别当前繁忙，请稍后重新开始回答',
        });
        return;
      }
    }
    try {
      upstream = voiceRoute.asrProvider === 'cartesia_ink'
        ? createCartesiaInkSocket()
        : createAlibabaRealtimeASRSocket();
      if (voiceRoute.asrProvider === 'cartesia_ink') {
        activeCartesiaInkStreams += 1;
      }
    } catch (error) {
      sendJSON(client, { type: 'error', error: error instanceof Error ? error.message : '实时 ASR 配置错误' });
      client.close(1011, 'Realtime ASR configuration error');
      return;
    }

    const connection = upstream;
    connection.on('open', () => {
      if (upstream !== connection) return;
      if (voiceRoute.asrProvider === 'cartesia_ink') {
        upstreamReady = true;
        upstream.send(buildCartesiaInkConfig());
        console.info('[Interview ASR WS] upstream ready', {
          sessionId: ticketSessionId,
          provider: 'cartesia_ink',
          model: getCartesiaInkModel(),
          activeStreams: activeCartesiaInkStreams,
        });
        flushAudio();
        return;
      }
      upstream.send(buildRealtimeSessionUpdate(language));
    });
    connection.on('message', (raw) => {
      touch();
      if (voiceRoute.asrProvider === 'cartesia_ink') {
        const result = forwardCartesiaInkEvent(client, raw, utteranceState);
        if (result.requestId) upstreamSessionId = result.requestId;
        console.info('[Interview ASR WS] Cartesia event', {
          sessionId: ticketSessionId,
          type: result.type,
          transcriptChars: result.transcriptChars,
          audioBytes: cartesiaAudioBytes,
        });
        if (result.ended) {
          // Ink counts idle sockets as concurrent STT. The current candidate
          // turn is complete, so release it immediately instead of keeping it
          // until the next answer or Cartesia's three-minute timeout. This is
          // an expected lifecycle event, not an ASR failure: notifying the
          // browser as `upstream_closed` made it fall back to the disabled
          // HTTP provider and stopped subsequent answers from reaching Ink.
          closeUpstream(true);
        }
        return;
      }
      let event: AlibabaASREvent | null = null;
      try {
        event = JSON.parse(raw.toString()) as AlibabaASREvent;
      } catch {
        // forwardAlibabaEvent will send a stable error to the browser if needed.
      }
      if (event?.type === 'session.updated') {
        upstreamReady = true;
        console.info('[Interview ASR WS] upstream ready', {
          sessionId: ticketSessionId,
          provider: 'alibaba',
          model: process.env.ALIBABA_ASR_REALTIME_MODEL?.trim() || 'qwen3-asr-flash-realtime',
        });
        // Echo the server-authorized language so test diagnostics can prove
        // which recognition language reached the provider for this ticket.
        sendJSON(client, { type: 'ready', session: event.session, language });
        flushAudio();
      } else {
        forwardAlibabaEvent(client, raw, utteranceState);
      }
      if (event?.type === 'session.created') upstreamSessionId = event.session?.id || null;
      if (typeof event?.usage?.duration === 'number' && Number.isFinite(event.usage.duration) && event.usage.duration >= 0) {
        providerAudioSeconds = event.usage.duration;
      }
      if (event?.type === 'conversation.item.input_audio_transcription.completed') {
        textCharacters += countTextCharacters(String(event.transcript || '').trim());
      }
      if (event?.type === 'session.finished') {
        finishing = false;
        void recordUsage('success');
        closeUpstream();
      }
    });
    connection.on('error', (error) => {
      if (upstream !== connection) return;
      console.error(`[Interview ASR WS] ${voiceRoute.asrProvider} connection failed:`, error.message);
      lastError = error.message;
      if (!finishing) sendJSON(client, { type: 'error', error: '实时 ASR 连接失败' });
    });
    connection.on('close', () => {
      const isCurrent = upstream === connection;
      if (isCurrent) {
        upstream = null;
        upstreamReady = false;
      }
      releaseCartesiaSlot(connection);
      const suppressNotice = suppressedUpstreamCloses.has(connection);
      if (!finishing && !suppressNotice) sendJSON(client, { type: 'upstream_closed' });
    });
  };

  client.on('message', async (raw, isBinary) => {
    touch();
    if (isBinary) {
      if (!started) {
        sendJSON(client, { type: 'error', error: '请先启动当前面试语音会话' });
        return;
      }
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
      audioBytes += chunk.byteLength;
      if (audioBytes > MAX_AUDIO_BYTES_PER_CONNECTION) {
        lastError = 'ASR audio limit exceeded';
        sendJSON(client, { type: 'error', error: '实时 ASR 音频额度已用尽' });
        void recordUsage('error');
        client.close(1008, 'ASR audio limit exceeded');
        return;
      }
      const audioMinutes = estimatePcmDurationSeconds(audioBytes, 16000, 1, 16) || 0;
      const requiredCreditBlocks = Math.max(1, Math.ceil(audioMinutes / ASR_CREDIT_BLOCK_MINUTES));
      while (creditReservations.length < requiredCreditBlocks) {
        try {
          // Reserve each actual minute as audio crosses it. This keeps a live
          // socket from becoming a free, unbounded ASR path.
          const reservation = await reserveCredits({
            userId,
            metric: 'asr_minutes',
            units: ASR_CREDIT_BLOCK_MINUTES,
            idempotencyKey: `${usageRequestId}:${creditReservations.length + 1}`,
            metadata: { feature: 'interview_asr_realtime', session_id: ticketSessionId, credit_block: creditReservations.length + 1 },
          });
          if (reservation) creditReservations.push(reservation);
        } catch (error) {
          const message = error instanceof Error ? error.message : '实时 ASR 积分不足';
          lastError = message;
          sendJSON(client, { type: 'error', error: message });
          client.close(1008, 'Realtime ASR credits unavailable');
          return;
        }
      }
      sendAudio(chunk);
      return;
    }

    let message: ClientStartMessage | { type: 'stop' } | { type: 'ping' } | { type: 'commit' };
    try {
      message = JSON.parse(raw.toString()) as typeof message;
    } catch {
      sendJSON(client, { type: 'error', error: '实时 ASR 客户端消息格式错误' });
      return;
    }

    if (message.type === 'start') {
      const requestedLanguage = message.language?.trim().toLowerCase();
      if (requestedLanguage && requestedLanguage !== language) {
        sendJSON(client, { type: 'error', error: '不支持的 ASR 语言' });
        return;
      }
      const requestedSessionId = Number(message.sessionId);
      if (!Number.isInteger(requestedSessionId) || requestedSessionId !== ticketSessionId) {
        sendJSON(client, { type: 'error', error: '实时 ASR 会话不匹配' });
        client.close(1008, 'Realtime ASR session mismatch');
        return;
      }
      interviewSessionId = ticketSessionId;
      started = true;
      if (voiceRoute.asrProvider === 'alibaba') {
        startUpstream();
      } else {
        // This is deliberately the proxy readiness, not the Ink-2 upstream
        // readiness. The browser starts microphone capture only after a
        // `ready` event, while Ink-2 must not be opened until real speech is
        // available because even an idle Ink WebSocket occupies concurrency.
        // Waiting for Ink here made both sides wait forever: no capture meant
        // no PCM, and no PCM meant no Ink connection or browser readiness.
        sendJSON(client, { type: 'ready', provider: 'cartesia', language, deferredUpstream: true });
      }
    } else if (message.type === 'stop') {
      finishing = true;
      if (upstream?.readyState === WebSocket.OPEN && voiceRoute.asrProvider === 'cartesia_ink') {
        upstream.send(buildCartesiaInkClose());
        setTimeout(() => closeUpstream(true), 1_500);
      } else if (upstream?.readyState === WebSocket.OPEN) upstream.send(buildRealtimeSessionFinish());
      else closeUpstream();
    } else if (message.type === 'commit') {
      if (upstream?.readyState === WebSocket.OPEN && voiceRoute.asrProvider === 'alibaba') {
        upstream.send(JSON.stringify({ type: 'input_audio_buffer.commit', event_id: createRealtimeEventId('event') }));
      }
    } else if (message.type === 'ping') {
      sendJSON(client, { type: 'pong' });
    }
  });

  client.on('close', () => {
    clearTimeout(connectionTimer);
    if (idleTimer) clearTimeout(idleTimer);
    if (cartesiaIdleTimer) clearTimeout(cartesiaIdleTimer);
    activeConnections = Math.max(0, activeConnections - 1);
    finishing = true;
    queuedAudio = [];
    queuedAudioBytes = 0;
    closeUpstream();
    void recordUsage(lastError ? 'error' : 'success');
  });
  client.on('error', (error) => {
    lastError = error instanceof Error ? error.message : 'ASR client connection failed';
    closeUpstream();
    void recordUsage('error');
  });
}

function forwardCartesiaInkEvent(
  client: WebSocket,
  raw: WebSocket.RawData,
  utteranceState: UpstreamUtteranceState,
): { ended: boolean; requestId: string | null; type: string; transcriptChars: number } {
  let event: CartesiaInkEvent;
  try {
    event = JSON.parse(raw.toString()) as CartesiaInkEvent;
  } catch {
    sendJSON(client, { type: 'error', error: 'Cartesia Ink-2 返回了无法解析的事件' });
    return { ended: false, requestId: null, type: 'parse_error', transcriptChars: 0 };
  }
  const transcript = String(event.transcript || '').trim();
  const requestId = event.request_id || null;
  switch (event.type) {
    case 'connected':
      // Browser proxy readiness was emitted before capture started. Do not
      // emit it again here, otherwise one upstream connection restarts client
      // handshake state in the middle of an answer.
      return { ended: false, requestId, type: event.type, transcriptChars: 0 };
    case 'turn.start': {
      const utteranceId = `ink_${++utteranceState.sequence}`;
      utteranceState.activeId = utteranceId;
      sendJSON(client, { type: 'speech_started', utteranceId, requestId });
      return { ended: false, requestId, type: event.type, transcriptChars: 0 };
    }
    case 'turn.update':
      sendJSON(client, {
        type: 'partial',
        itemId: requestId || undefined,
        utteranceId: utteranceState.activeId,
        text: transcript,
        confirmedText: transcript,
        language: 'en',
      });
      return { ended: false, requestId, type: event.type, transcriptChars: transcript.length };
    case 'turn.eager_end':
      sendJSON(client, {
        type: 'partial',
        itemId: requestId || undefined,
        utteranceId: utteranceState.activeId,
        text: transcript,
        confirmedText: transcript,
        language: 'en',
      });
      return { ended: false, requestId, type: event.type, transcriptChars: transcript.length };
    case 'turn.resume':
      return { ended: false, requestId, type: event.type, transcriptChars: 0 };
    case 'turn.end': {
      const utteranceId = utteranceState.activeId;
      sendJSON(client, { type: 'speech_stopped', utteranceId, requestId });
      if (transcript) {
        sendJSON(client, {
          type: 'final',
          itemId: requestId || `ink-final-${utteranceState.sequence}`,
          utteranceId,
          text: transcript,
          language: 'en',
        });
      }
      utteranceState.activeId = null;
      return { ended: true, requestId, type: event.type, transcriptChars: transcript.length };
    }
    case 'error':
      sendJSON(client, {
        type: 'error',
        code: event.error_code || 'CARTESIA_INK_ERROR',
        error: event.message || event.title || 'Cartesia Ink-2 识别失败',
      });
      return { ended: false, requestId, type: event.type, transcriptChars: transcript.length };
    default:
      return { ended: false, requestId, type: event.type || 'unknown', transcriptChars: transcript.length };
  }
}

export function attachInterviewASRWebSocket(server: Server): (request: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => void {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_QUEUED_AUDIO_BYTES,
    handleProtocols: (protocols) => protocols.has(CLIENT_PROTOCOL) ? CLIENT_PROTOCOL : '',
  });

  const handleUpgrade = (request: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
    const requestUrl = new URL(request.url || '/', 'http://localhost');
    if (requestUrl.pathname !== INTERVIEW_ASR_WS_PATH) return;

    const protocols = getProtocols(request);
    const ticket = getTicket(request);
    if (!protocols.includes(CLIENT_PROTOCOL) || !ticket) {
      console.warn('[Interview ASR WS] rejected upgrade: missing protocol or ticket');
      rejectUpgrade(socket, 401, 'Missing realtime ASR authentication');
      return;
    }

    void authenticateTicket(ticket).then((auth) => {
      if (!auth) {
        console.warn('[Interview ASR WS] rejected upgrade: invalid or expired ticket');
        rejectUpgrade(socket, 401, 'Invalid realtime ASR authentication');
        return;
      }
      if (activeConnections >= MAX_ACTIVE_CONNECTIONS) {
        console.warn('[Interview ASR WS] rejected upgrade: proxy capacity reached');
        rejectUpgrade(socket, 429, 'Realtime ASR capacity reached');
        return;
      }
      console.info('[Interview ASR WS] browser proxy connected', {
        sessionId: auth.sessionId,
        provider: auth.voiceRoute.asrProvider,
        language: auth.language,
      });
      wss.handleUpgrade(request, socket, head, (client) => setupConnection(client, auth));
    }).catch((error) => {
      console.error('[Interview ASR WS] Upgrade failed:', error);
      rejectUpgrade(socket, 401, 'Realtime ASR authentication failed');
    });
  };
  server.on('upgrade', handleUpgrade);
  return handleUpgrade;
}
