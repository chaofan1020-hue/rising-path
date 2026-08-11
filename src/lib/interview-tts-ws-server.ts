import type { IncomingMessage, Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import {
  getCartesiaVoiceId,
  normalizeSpeechRate,
} from '@/lib/tts-provider';
import WebSocket, { WebSocketServer } from 'ws';

const TTS_WS_PATH = '/ws/interview/tts';
const CLIENT_PROTOCOL = 'rising-path-tts-v1';
const AUTH_PROTOCOL_PREFIX = 'rising-path-auth.';
const MAX_CONNECTION_MS = 5 * 60 * 1000;
const IDLE_TIMEOUT_MS = 60 * 1000;
const MAX_ACTIVE_CONNECTIONS = 50;
let activeConnections = 0;

interface CartesiaEvent {
  type?: string;
  data?: string;
  done?: boolean;
  message?: string;
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

function getAccessToken(request: IncomingMessage): string | null {
  const authProtocol = getProtocols(request).find((protocol) => protocol.startsWith(AUTH_PROTOCOL_PREFIX));
  return authProtocol?.slice(AUTH_PROTOCOL_PREFIX.length).trim() || null;
}

async function authenticate(accessToken: string): Promise<boolean> {
  try {
    const client = getSupabaseClient(accessToken);
    const { data, error } = await client.auth.getUser(accessToken);
    return !error && Boolean(data.user);
  } catch (error) {
    console.error('[Interview TTS WS] Supabase authentication failed:', error);
    return false;
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

function languageCode(language?: string): 'zh' | 'en' {
  return language?.toLowerCase().startsWith('en') ? 'en' : 'zh';
}

function handleConnection(client: WebSocket): void {
  activeConnections += 1;
  let cartesia: WebSocket | null = null;
  let started = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const connectionTimer = setTimeout(() => client.close(1008, 'TTS connection time limit'), MAX_CONNECTION_MS);
  const touch = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => client.close(1000, 'TTS connection idle timeout'), IDLE_TIMEOUT_MS);
  };
  touch();

  client.on('message', (raw, isBinary) => {
    touch();
    if (isBinary) return;
    let request: {
      type?: string;
      text?: string;
      language?: string;
      speaker?: string;
      speechRate?: number;
    };
    try {
      request = JSON.parse(raw.toString()) as typeof request;
    } catch {
      sendJSON(client, { type: 'error', error: 'TTS 请求格式错误' });
      return;
    }
    if (request.type !== 'speak' || !request.text?.trim() || started) return;
    if (request.text.length > 2_000) {
      sendJSON(client, { type: 'error', error: 'TTS 文本不能超过 2000 字符' });
      return;
    }
    started = true;

    const language = languageCode(request.language);
    try {
      cartesia = createCartesiaSocket();
      cartesia.on('open', () => {
        cartesia?.send(JSON.stringify({
          model_id: process.env.CARTESIA_MODEL?.trim() || 'sonic-3.5',
          transcript: request.text!.slice(0, 2000),
          voice: { mode: 'id', id: getCartesiaVoiceId(language, request.speaker) },
          language,
          context_id: randomUUID(),
          output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 44100 },
          generation_config: { speed: normalizeSpeechRate(request.speechRate) },
          continue: false,
        }));
      });
      cartesia.on('message', (message) => {
        touch();
        let event: CartesiaEvent;
        try {
          event = JSON.parse(message.toString()) as CartesiaEvent;
        } catch {
          sendJSON(client, { type: 'error', error: 'Cartesia 返回了无法解析的事件' });
          return;
        }
        if (event.type === 'chunk' && typeof event.data === 'string') {
          if (client.readyState === WebSocket.OPEN) client.send(Buffer.from(event.data, 'base64'));
        } else if (event.type === 'done' || event.done === true) {
          sendJSON(client, { type: 'done', sampleRate: 44100 });
          cartesia?.close(1000);
        } else if (event.type === 'error') {
          sendJSON(client, { type: 'error', error: event.message || 'Cartesia TTS 生成失败' });
        }
      });
      cartesia.on('error', (error) => {
        console.error('[Interview TTS WS] Cartesia connection failed:', error.message);
        sendJSON(client, { type: 'error', error: 'Cartesia TTS 连接失败' });
      });
      cartesia.on('close', () => {
        cartesia = null;
      });
    } catch (error) {
      sendJSON(client, { type: 'error', error: error instanceof Error ? error.message : 'Cartesia TTS 配置错误' });
    }
  });

  client.on('close', () => {
    clearTimeout(connectionTimer);
    if (idleTimer) clearTimeout(idleTimer);
    activeConnections = Math.max(0, activeConnections - 1);
    if (cartesia?.readyState === WebSocket.OPEN) cartesia.close(1000);
    else cartesia?.terminate();
    cartesia = null;
  });
}

export function attachInterviewTTSWebSocket(server: Server): void {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    handleProtocols: (protocols) => protocols.has(CLIENT_PROTOCOL) ? CLIENT_PROTOCOL : '',
  });

  server.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url || '/', 'http://localhost');
    if (requestUrl.pathname !== TTS_WS_PATH) return;
    const protocols = getProtocols(request);
    const accessToken = getAccessToken(request);
    if (!protocols.includes(CLIENT_PROTOCOL) || !accessToken) {
      rejectUpgrade(socket, 401, 'Missing realtime TTS authentication');
      return;
    }
    void authenticate(accessToken).then((valid) => {
      if (!valid) {
        rejectUpgrade(socket, 401, 'Invalid realtime TTS authentication');
        return;
      }
      if (activeConnections >= MAX_ACTIVE_CONNECTIONS) {
        rejectUpgrade(socket, 429, 'Realtime TTS capacity reached');
        return;
      }
      wss.handleUpgrade(request, socket, head, handleConnection);
    }).catch((error) => {
      console.error('[Interview TTS WS] Upgrade failed:', error);
      rejectUpgrade(socket, 401, 'Realtime TTS authentication failed');
    });
  });
}
