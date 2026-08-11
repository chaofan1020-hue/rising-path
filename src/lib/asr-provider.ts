export interface ASRRequest {
  audioBase64: string;
  audioMimeType?: string;
  language?: string;
}

export interface ASRResult {
  text: string;
  language?: string;
  emotion?: string;
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
      choices?: Array<{ message?: { content?: unknown; annotations?: Array<{ language?: string; emotion?: string }> } }>;
      output?: { choices?: Array<{ message?: { content?: unknown; annotations?: Array<{ language?: string; emotion?: string }> } }> };
      message?: string;
    };
    if (!response.ok) {
      throw new Error(`阿里云 ASR 请求失败（${response.status}）：${payload.message || '未知错误'}`);
    }

    const message = payload.choices?.[0]?.message || payload.output?.choices?.[0]?.message;
    const annotation = message?.annotations?.[0];
    return {
      text: extractText(message?.content).trim(),
      language: annotation?.language,
      emotion: annotation?.emotion,
    };
  } finally {
    clearTimeout(timeout);
  }
}
