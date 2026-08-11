import OpenAI from 'openai';

export type TextMessageRole = 'system' | 'user' | 'assistant';

export interface TextMessage {
  role: TextMessageRole;
  content: string;
}

export interface TextGenerationOptions {
  temperature?: number;
  thinking?: 'disabled' | 'enabled';
  responseFormat?: {
    name: string;
    schema: Record<string, unknown>;
  };
}

export interface TextChunk {
  content: string;
}

export interface TextProviderClient {
  invoke(messages: TextMessage[], options?: TextGenerationOptions): Promise<TextChunk>;
  stream(messages: TextMessage[], options?: TextGenerationOptions): AsyncIterable<TextChunk>;
}

export type AIProvider = 'alibaba';

export class AIProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIProviderConfigError';
  }
}

function getTimeoutMs(): number {
  const rawValue = process.env.AI_LLM_TIMEOUT_MS?.trim() || process.env.RESUME_PROFILE_LLM_TIMEOUT_MS?.trim();
  if (!rawValue) return 45_000;

  const timeoutMs = Number(rawValue);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 120_000) {
    throw new AIProviderConfigError(
      'AI_LLM_TIMEOUT_MS 配置无效，请设置为 5000 到 120000 之间的整数（毫秒）',
    );
  }
  return timeoutMs;
}

export function getAIProvider(): AIProvider {
  const provider = process.env.AI_PROVIDER?.trim().toLowerCase() || 'alibaba';
  if (provider === 'alibaba') return provider;
  throw new AIProviderConfigError('AI_PROVIDER 只支持 alibaba；TTS 请单独使用 Cartesia');
}

function createAlibabaClient(timeoutMs: number): TextProviderClient {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) {
    throw new AIProviderConfigError(
      'Alibaba AI 未配置，请设置 DASHSCOPE_API_KEY',
    );
  }

  const baseURL = process.env.ALIBABA_BASE_URL?.trim()
    || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  try {
    const modelUrl = new URL(baseURL);
    if (modelUrl.protocol !== 'http:' && modelUrl.protocol !== 'https:') throw new Error('invalid protocol');
  } catch {
    throw new AIProviderConfigError(
      'ALIBABA_BASE_URL 配置无效，请设置完整的 http(s) 地址',
    );
  }

  const model = process.env.ALIBABA_MODEL?.trim() || 'qwen3.7-plus';
  const client = new OpenAI({
    apiKey,
    baseURL,
    timeout: timeoutMs,
    maxRetries: 0,
  });

  const input = (messages: TextMessage[]) => messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  return {
    async invoke(messages, options = {}) {
      const response = await client.chat.completions.create({
        model,
        messages: input(messages),
        temperature: options.temperature,
        response_format: options.responseFormat ? { type: 'json_object' } : undefined,
      });
      return { content: response.choices[0]?.message?.content || '' };
    },
    async *stream(messages, options = {}) {
      const stream = await client.chat.completions.create({
        model,
        messages: input(messages),
        temperature: options.temperature,
        stream: true,
        response_format: options.responseFormat ? { type: 'json_object' } : undefined,
      });
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) yield { content };
      }
    },
  };
}

export function createTextProviderClient(options: { requestHeaders?: Headers } = {}): TextProviderClient {
  const timeoutMs = getTimeoutMs();
  void options;
  return createAlibabaClient(timeoutMs);
}
