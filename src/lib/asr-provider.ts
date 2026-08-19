export interface ASRRequest {
  audioBase64: string;
  audioMimeType?: string;
  language?: string;
}

export interface ASRUsage {
  inputAudioSeconds: number | null;
  audioTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  requestId: string | null;
  model: string | null;
  usageSource: 'actual' | 'unknown';
}

export interface ASRResult {
  text: string;
  language?: string;
  emotion?: string;
  audioBytes: number | null;
  usage: ASRUsage;
}

export class ASRProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ASRProviderConfigError';
  }
}

function getTimeoutMs(): number {
  const raw = process.env.ALIBABA_ASR_TIMEOUT_MS?.trim() || process.env.AI_LLM_TIMEOUT_MS?.trim() || '30000';
  const timeoutMs = Number(raw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5000 || timeoutMs > 120000) {
    throw new ASRProviderConfigError(
      'ALIBABA_ASR_TIMEOUT_MS 配置无效，请设置为 5000 到 120000 之间的整数（毫秒）',
    );
  }
  return timeoutMs;
}

function getEndpoint(): string {
  const baseUrl = process.env.ALIBABA_ASR_BASE_URL?.trim()
    || process.env.ALIBABA_BASE_URL?.trim()
    || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('invalid protocol');
  } catch {
    throw new ASRProviderConfigError('ALIBABA_ASR_BASE_URL 配置无效，请设置完整的 http(s) 地址');
  }
  return `${baseUrl.replace(/\/$/, '')}/chat/completions`;
}

function toDataUrl(audioBase64: string, audioMimeType?: string): string {
  if (audioBase64.startsWith('data:')) return audioBase64;
  const mimeType = /^audio\/[a-z0-9.+-]+$/i.test(audioMimeType || '')
    ? audioMimeType
    : 'audio/webm';
  return `data:${mimeType};base64,${audioBase64}`;
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .flatMap((item) => {
      if (typeof item === 'string') return [item];
      if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') return [item.text];
      return [];
    })
    .join('');
}

function toNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function toNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function decodeAudioByteLength(audioBase64: string): number | null {
  const encoded = audioBase64.replace(/^data:[^,]+,/, '').replace(/\s/g, '');
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;
  try {
    return Buffer.from(encoded, 'base64').byteLength;
  } catch {
    return null;
  }
}

export async function recognizeWithAlibaba(request: ASRRequest): Promise<ASRResult> {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) throw new ASRProviderConfigError('阿里云 ASR 未配置，请设置 DASHSCOPE_API_KEY');

  const model = process.env.ALIBABA_ASR_MODEL?.trim() || 'qwen3-asr-flash';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());
  try {
    const response = await fetch(getEndpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [{
            type: 'input_audio',
            input_audio: { data: toDataUrl(request.audioBase64, request.audioMimeType) },
          }],
        }],
        stream: false,
        asr_options: {
          ...(request.language ? { language: request.language } : {}),
          enable_itn: false,
        },
      }),
      signal: controller.signal,
    });

    const payload = await response.json() as {
      id?: string;
      model?: string;
      choices?: Array<{ message?: { content?: unknown; annotations?: Array<{ language?: string; emotion?: string }> } }>;
      output?: { choices?: Array<{ message?: { content?: unknown; annotations?: Array<{ language?: string; emotion?: string }> } }> };
      usage?: {
        seconds?: number;
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
        prompt_tokens_details?: { audio_tokens?: number; text_tokens?: number };
        input_tokens_details?: { audio_tokens?: number; text_tokens?: number };
      };
      message?: string;
    };
    if (!response.ok) {
      throw new Error(`阿里云 ASR 请求失败（${response.status}）：${payload.message || '未知错误'}`);
    }

    const message = payload.choices?.[0]?.message || payload.output?.choices?.[0]?.message;
    const annotation = message?.annotations?.[0];
    const usage = payload.usage;
    const tokenDetails = usage?.prompt_tokens_details || usage?.input_tokens_details;
    const inputTokens = toNonNegativeInteger(usage?.prompt_tokens ?? usage?.input_tokens);
    const outputTokens = toNonNegativeInteger(usage?.completion_tokens ?? usage?.output_tokens);
    const totalTokens = toNonNegativeInteger(
      usage?.total_tokens ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
    );
    const inputAudioSeconds = toNonNegativeNumber(usage?.seconds);
    const audioTokens = toNonNegativeInteger(tokenDetails?.audio_tokens);
    return {
      text: extractText(message?.content).trim(),
      language: annotation?.language,
      emotion: annotation?.emotion,
      audioBytes: decodeAudioByteLength(request.audioBase64),
      usage: {
        inputAudioSeconds,
        audioTokens,
        inputTokens,
        outputTokens,
        totalTokens,
        requestId: typeof payload.id === 'string' ? payload.id : null,
        model: typeof payload.model === 'string' ? payload.model : model,
        usageSource: inputAudioSeconds !== null || inputTokens !== null || outputTokens !== null || totalTokens !== null
          ? 'actual'
          : 'unknown',
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
