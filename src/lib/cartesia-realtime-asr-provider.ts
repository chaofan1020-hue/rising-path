import WebSocket from 'ws';

export class CartesiaRealtimeASRConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CartesiaRealtimeASRConfigError';
  }
}

function readNumberEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]?.trim());
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

export function isCartesiaInkEnabled(): boolean {
  return process.env.CARTESIA_INK_ENABLED?.trim().toLowerCase() !== 'false';
}

export function getCartesiaInkModel(): string {
  return process.env.CARTESIA_INK_MODEL?.trim() || 'ink-2';
}

export function getCartesiaInkIdleCloseMs(): number {
  return readNumberEnv('CARTESIA_INK_IDLE_CLOSE_MS', 10_000, 2_000, 60_000);
}

function getCartesiaInkVersion(): string {
  // Ink-2 uses a newer STT API revision than the existing Sonic integration.
  // Keep the versions independent so a TTS upgrade cannot silently break ASR.
  return process.env.CARTESIA_INK_VERSION?.trim() || '2026-08-14';
}

function getCartesiaInkEndpoint(): string {
  const baseUrl = process.env.CARTESIA_BASE_URL?.trim() || 'https://api.cartesia.ai';
  const version = getCartesiaInkVersion();
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new CartesiaRealtimeASRConfigError('CARTESIA_BASE_URL 配置无效');
  }
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  url.pathname = '/stt/turns/websocket';
  url.search = '';
  url.searchParams.set('model', getCartesiaInkModel());
  url.searchParams.set('encoding', 'pcm_s16le');
  url.searchParams.set('sample_rate', '16000');
  url.searchParams.set('cartesia_version', version);
  return url.toString();
}

export function createCartesiaInkSocket(): WebSocket {
  const apiKey = process.env.CARTESIA_API_KEY?.trim();
  if (!isCartesiaInkEnabled()) {
    throw new CartesiaRealtimeASRConfigError('Cartesia Ink-2 ASR 已被禁用');
  }
  if (!apiKey) {
    throw new CartesiaRealtimeASRConfigError('Cartesia Ink-2 ASR 未配置，请设置 CARTESIA_API_KEY');
  }
  return new WebSocket(getCartesiaInkEndpoint(), {
    handshakeTimeout: 15_000,
    headers: { 'X-API-Key': apiKey },
  });
}

export function buildCartesiaInkConfig(): string {
  return JSON.stringify({
    type: 'config',
    turn: {
      // The browser has already gated PCM with Silero, so Ink can use more
      // sensitive defaults for normal quiet laptop/headset speech without
      // opening the provider to background-room noise.
      start_threshold: readNumberEnv('CARTESIA_INK_TURN_START_THRESHOLD', 0.55, 0, 1),
      eager_end_threshold: readNumberEnv('CARTESIA_INK_TURN_EAGER_END_THRESHOLD', 0.32, 0, 1),
      end_threshold: readNumberEnv('CARTESIA_INK_TURN_END_THRESHOLD', 0.14, 0, 1),
      end_timeout_ms: readNumberEnv('CARTESIA_INK_TURN_END_TIMEOUT_MS', 1_800, 200, 10_000),
    },
  });
}

export function buildCartesiaInkClose(): string {
  return JSON.stringify({ type: 'close' });
}
