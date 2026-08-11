export type TTSProvider = 'cartesia';

export interface TTSRequest {
  text: string;
  language?: string;
  speaker?: string;
  speechRate?: number;
  userId?: string;
}

export interface TTSResult {
  audio: ArrayBuffer;
  contentType: string;
  provider: TTSProvider;
}

export interface TTSProviderClient {
  synthesize(request: TTSRequest): Promise<TTSResult>;
}

export class TTSProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TTSProviderConfigError';
  }
}

function getTimeoutMs(): number {
  const raw = process.env.TTS_TIMEOUT_MS?.trim() || '30000';
  const timeoutMs = Number(raw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5000 || timeoutMs > 120000) {
    throw new TTSProviderConfigError(
      'TTS_TIMEOUT_MS 配置无效，请设置为 5000 到 120000 之间的整数（毫秒）',
    );
  }
  return timeoutMs;
}

export function getTTSProvider(): TTSProvider {
  const provider = process.env.TTS_PROVIDER?.trim().toLowerCase() || 'cartesia';
  if (provider === 'cartesia') return provider;
  throw new TTSProviderConfigError('TTS_PROVIDER 只支持 cartesia');
}

function normalizeLanguage(language?: string): 'zh' | 'en' {
  return language?.toLowerCase().startsWith('en') ? 'en' : 'zh';
}

export function normalizeSpeechRate(speechRate?: number): number {
  const rate = typeof speechRate === 'number' && speechRate >= -50 && speechRate <= 100
    ? speechRate
    : 0;
  return Math.max(0.8, Math.min(1.4, 1 + rate / 250));
}

function isCartesiaVoiceId(value: string): boolean {
  return value.startsWith('cartesia:') || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function getCartesiaVoiceId(language: 'zh' | 'en', speaker?: string): string {
  const requested = speaker?.trim();
  if (requested && isCartesiaVoiceId(requested)) {
    return requested.startsWith('cartesia:') ? requested.slice('cartesia:'.length) : requested;
  }

  const configured = language === 'en'
    ? process.env.CARTESIA_VOICE_EN?.trim()
    : process.env.CARTESIA_VOICE_ZH?.trim();
  if (!configured) {
    throw new TTSProviderConfigError(
      `Cartesia ${language === 'en' ? '英文' : '中文'}音色未配置，请设置 CARTESIA_VOICE_${language === 'en' ? 'EN' : 'ZH'}`,
    );
  }
  return configured;
}

function getCartesiaBaseUrl(): string {
  const baseUrl = process.env.CARTESIA_BASE_URL?.trim() || 'https://api.cartesia.ai';
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('invalid protocol');
  } catch {
    throw new TTSProviderConfigError('CARTESIA_BASE_URL 配置无效，请设置完整的 http(s) 地址');
  }
  return baseUrl.replace(/\/$/, '');
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function createCartesiaClient(timeoutMs: number): TTSProviderClient {
  const apiKey = process.env.CARTESIA_API_KEY?.trim();
  if (!apiKey) {
    throw new TTSProviderConfigError('Cartesia TTS 未配置，请设置 CARTESIA_API_KEY');
  }

  const model = process.env.CARTESIA_MODEL?.trim() || 'sonic-3.5';
  const version = process.env.CARTESIA_VERSION?.trim() || '2026-03-01';
  const baseUrl = getCartesiaBaseUrl();

  return {
    async synthesize(request) {
      const language = normalizeLanguage(request.language);
      const response = await fetchWithTimeout(`${baseUrl}/tts/bytes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Cartesia-Version': version,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_id: model,
          transcript: request.text.slice(0, 1000),
          voice: { mode: 'id', id: getCartesiaVoiceId(language, request.speaker) },
          output_format: { container: 'mp3', bit_rate: 128000 },
          language,
          generation_config: {
            volume: 1,
            speed: normalizeSpeechRate(request.speechRate),
          },
        }),
      }, timeoutMs);

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(`Cartesia TTS 请求失败（${response.status}）：${detail}`);
      }

      return {
        audio: await response.arrayBuffer(),
        contentType: response.headers.get('content-type')?.split(';')[0] || 'audio/mpeg',
        provider: 'cartesia',
      };
    },
  };
}

export function createTTSProviderClient(options: { requestHeaders?: Headers } = {}): TTSProviderClient {
  void options;
  return createCartesiaClient(getTimeoutMs());
}
