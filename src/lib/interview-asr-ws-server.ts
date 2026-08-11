import type { IncomingMessage, Server } from 'node:http';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import WebSocket, { WebSocketServer } from 'ws';
import {
  INTERVIEW_ASR_WS_PATH,
  buildRealtimeAudioAppend,
  buildRealtimeSessionFinish,
  buildRealtimeSessionUpdate,
  createAlibabaRealtimeASRSocket,
  createRealtimeEventId,
} from '@/lib/asr-realtime-provider';

const CLIENT_PROTOCOL = 'rising-path-asr-v1';
const AUTH_PROTOCOL_PREFIX = 'rising-path-auth.';
const MAX_QUEUED_AUDIO_BYTES = 1024 * 1024;
const MAX_AUDIO_BYTES_PER_CONNECTION = 20 * 1024 * 1024;
const MAX_CONNECTION_MS = 5 * 60 * 1000;
const IDLE_TIMEOUT_MS = 60 * 1000;
const MAX_ACTIVE_CONNECTIONS = 50;
let activeConnections = 0;

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
  error?: { message?: string };
}

interface ClientStartMessage {
  type: 'start';
  language?: string;
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

function getAccessToken(request: IncomingMessage): string | null {
  const authProtocol = getProtocols(request).find((protocol) => protocol.startsWith(AUTH_PROTOCOL_PREFIX));
  const token = authProtocol?.slice(AUTH_PROTOCOL_PREFIX.length).trim();
  return token || null;
}

async function authenticate(accessToken: string): Promise<string | null> {
  try {
    const client = getSupabaseClient(accessToken);
    const { data, error } = await client.auth.getUser(accessToken);
    return error || !data.user ? null : data.user.id;
  } catch (error) {
    console.error('[Interview ASR WS] Supabase authentication failed:', error);
    return null;
  }
}

function forwardAlibabaEvent(client: WebSocket, raw: WebSocket.RawData): void {
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
    case 'input_audio_buffer.speech_started':
      sendJSON(client, { type: 'speech_started', eventId: event.event_id });
      return;
    case 'input_audio_buffer.speech_stopped':
      sendJSON(client, { type: 'speech_stopped', eventId: event.event_id });
      return;
    case 'conversation.item.input_audio_transcription.text':
      sendJSON(client, {
        type: 'partial',
        itemId: event.item_id,
        text: `${event.text || ''}${event.stash || ''}`.trim(),
        confirmedText: event.text || '',
        draftText: event.stash || '',
        language: event.language,
        emotion: event.emotion,
      });
      return;
    case 'conversation.item.input_audio_transcription.completed':
      sendJSON(client, {
        type: 'final',
        itemId: event.item_id,
        text: String(event.transcript || '').trim(),
        language: event.language,
        emotion: event.emotion,
      });
      return;
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

function setupConnection(client: WebSocket, userId: string): void {
  activeConnections += 1;
  let upstream: WebSocket | null = null;
  let upstreamReady = false;
  let finishing = false;
  let language = 'zh';
  let queuedAudio: Buffer[] = [];
  let queuedAudioBytes = 0;
  let audioBytes = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const connectionTimer = setTimeout(() => client.close(1008, 'ASR connection time limit'), MAX_CONNECTION_MS);
  const touch = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => client.close(1000, 'ASR connection idle timeout'), IDLE_TIMEOUT_MS);
  };
  touch();

  const closeUpstream = () => {
    if (!upstream) return;
    if (upstream.readyState === WebSocket.OPEN) upstream.close(1000);
    else if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
    upstream = null;
    upstreamReady = false;
  };

  const sendAudio = (chunk: Buffer) => {
    audioBytes += chunk.byteLength;
    if (audioBytes > MAX_AUDIO_BYTES_PER_CONNECTION) {
      sendJSON(client, { type: 'error', error: '实时 ASR 音频额度已用尽' });
      client.close(1008, 'ASR audio limit exceeded');
      return;
    }
    if (!upstream || !upstreamReady || upstream.readyState !== WebSocket.OPEN) {
      if (queuedAudioBytes + chunk.byteLength <= MAX_QUEUED_AUDIO_BYTES) {
        queuedAudio.push(chunk);
        queuedAudioBytes += chunk.byteLength;
      }
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
    try {
      upstream = createAlibabaRealtimeASRSocket();
    } catch (error) {
      sendJSON(client, { type: 'error', error: error instanceof Error ? error.message : '实时 ASR 配置错误' });
      client.close(1011, 'Realtime ASR configuration error');
      return;
    }

    upstream.on('open', () => {
      if (!upstream) return;
      upstream.send(buildRealtimeSessionUpdate(language));
    });
    upstream.on('message', (raw) => {
      touch();
      let event: AlibabaASREvent | null = null;
      try {
        event = JSON.parse(raw.toString()) as AlibabaASREvent;
      } catch {
        // forwardAlibabaEvent will send a stable error to the browser if needed.
      }
      if (event?.type === 'session.updated') {
        upstreamReady = true;
        sendJSON(client, { type: 'ready', session: event.session });
        flushAudio();
      } else {
        forwardAlibabaEvent(client, raw);
      }
      if (event?.type === 'session.finished') {
        finishing = false;
        closeUpstream();
      }
    });
    upstream.on('error', (error) => {
      console.error('[Interview ASR WS] Alibaba connection failed:', error.message);
      if (!finishing) sendJSON(client, { type: 'error', error: '实时 ASR 连接失败' });
    });
    upstream.on('close', () => {
      upstream = null;
      upstreamReady = false;
      if (!finishing) sendJSON(client, { type: 'upstream_closed' });
    });
  };

  client.on('message', (raw, isBinary) => {
    touch();
    if (isBinary) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
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
      const requestedLanguage = message.language?.trim().toLowerCase() || 'zh';
      if (requestedLanguage !== 'zh' && requestedLanguage !== 'en') {
        sendJSON(client, { type: 'error', error: '不支持的 ASR 语言' });
        return;
      }
      language = requestedLanguage;
      startUpstream();
    } else if (message.type === 'stop') {
      finishing = true;
      if (upstream?.readyState === WebSocket.OPEN) upstream.send(buildRealtimeSessionFinish());
      else closeUpstream();
    } else if (message.type === 'commit') {
      if (upstream?.readyState === WebSocket.OPEN) {
        upstream.send(JSON.stringify({ type: 'input_audio_buffer.commit', event_id: createRealtimeEventId('event') }));
      }
    } else if (message.type === 'ping') {
      sendJSON(client, { type: 'pong' });
    }
  });

  client.on('close', () => {
    clearTimeout(connectionTimer);
    if (idleTimer) clearTimeout(idleTimer);
    activeConnections = Math.max(0, activeConnections - 1);
    finishing = true;
    queuedAudio = [];
    queuedAudioBytes = 0;
    closeUpstream();
  });
  client.on('error', () => closeUpstream());
}

export function attachInterviewASRWebSocket(server: Server): void {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_QUEUED_AUDIO_BYTES,
    handleProtocols: (protocols) => protocols.has(CLIENT_PROTOCOL) ? CLIENT_PROTOCOL : '',
  });

  server.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url || '/', 'http://localhost');
    if (requestUrl.pathname !== INTERVIEW_ASR_WS_PATH) return;

    const protocols = getProtocols(request);
    const accessToken = getAccessToken(request);
    if (!protocols.includes(CLIENT_PROTOCOL) || !accessToken) {
      rejectUpgrade(socket, 401, 'Missing realtime ASR authentication');
      return;
    }

    void authenticate(accessToken).then((userId) => {
      if (!userId) {
        rejectUpgrade(socket, 401, 'Invalid realtime ASR authentication');
        return;
      }
      if (activeConnections >= MAX_ACTIVE_CONNECTIONS) {
        rejectUpgrade(socket, 429, 'Realtime ASR capacity reached');
        return;
      }
      wss.handleUpgrade(request, socket, head, (client) => setupConnection(client, userId));
    }).catch((error) => {
      console.error('[Interview ASR WS] Upgrade failed:', error);
      rejectUpgrade(socket, 401, 'Realtime ASR authentication failed');
    });
  });
}
