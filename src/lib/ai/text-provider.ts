import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';

export type TextUsageSource = 'actual' | 'estimated' | 'unknown';

export interface TextUsage {
  provider: string;
  model: string | null;
  requestId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  usageSource: TextUsageSource;
}

export type TextMessageRole = 'system' | 'user' | 'assistant';

export interface TextMessage {
  role: TextMessageRole;
  content: string;
}

export interface TextGenerationOptions {
  temperature?: number;
  thinking?: 'disabled' | 'enabled';
  requestId?: string;
  responseFormat?: {
    name: string;
    schema: Record<string, unknown>;
  };
}

export interface TextChunk {
  content: string;
  usage?: TextUsage;
}

export interface TextProviderClient {
  invoke(messages: TextMessage[], options?: TextGenerationOptions): Promise<TextChunk>;
  stream(messages: TextMessage[], options?: TextGenerationOptions): AsyncIterable<TextChunk>;
}

export interface TextProviderOptions {
  requestHeaders?: Headers;
  model?: string;
  /** A feature-specific ceiling. It may be lower than the global default. */
  timeoutMs?: number;
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

function createAlibabaClient(timeoutMs: number, requestedModel?: string): TextProviderClient {
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

  const model = requestedModel?.trim() || process.env.ALIBABA_MODEL?.trim() || 'qwen3.7-plus';
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
      const requestId = options.requestId || randomUUID();
      const request = {
        model,
        messages: input(messages),
        temperature: options.temperature,
        response_format: options.responseFormat ? { type: 'json_object' } : undefined,
        ...(options.thinking === 'disabled' ? { enable_thinking: false } : {}),
      };
      const response = await client.chat.completions.create(request as never);
      const usage = response.usage;
      return {
        content: response.choices[0]?.message?.content || '',
        usage: {
          provider: 'alibaba',
          model: response.model || model,
          requestId: response.id || requestId,
          inputTokens: usage?.prompt_tokens ?? null,
          outputTokens: usage?.completion_tokens ?? null,
          totalTokens: usage?.total_tokens ?? null,
          usageSource: usage ? 'actual' : 'unknown',
        },
      };
    },
    async *stream(messages, options = {}) {
      const requestId = options.requestId || randomUUID();
      const request = {
        model,
        messages: input(messages),
        temperature: options.temperature,
        stream: true,
        stream_options: { include_usage: true },
        response_format: options.responseFormat ? { type: 'json_object' } : undefined,
        ...(options.thinking === 'disabled' ? { enable_thinking: false } : {}),
      };
      const stream = await client.chat.completions.create(
        request as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
      );
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        const usage = chunk.usage;
        if (content || usage) {
          yield {
            content: content || '',
            ...(usage
              ? {
                  usage: {
                    provider: 'alibaba',
                    model: chunk.model || model,
                    requestId: chunk.id || requestId,
                    inputTokens: usage.prompt_tokens ?? null,
                    outputTokens: usage.completion_tokens ?? null,
                    totalTokens: usage.total_tokens ?? null,
                    usageSource: 'actual' as const,
                  },
                }
              : {}),
          };
        }
      }
    },
  };
}

export function createTextProviderClient(options: TextProviderOptions = {}): TextProviderClient {
  const configuredTimeoutMs = getTimeoutMs();
  const timeoutMs = options.timeoutMs === undefined
    ? configuredTimeoutMs
    : Math.min(configuredTimeoutMs, options.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000) {
    throw new AIProviderConfigError('文本模型请求超时必须至少为 5000 毫秒');
  }
  return createAlibabaClient(timeoutMs, options.model);
}
