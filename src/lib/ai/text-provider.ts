import OpenAI from 'openai';
import { Config, HeaderUtils, LLMClient } from 'coze-coding-dev-sdk';

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

export type AIProvider = 'coze' | 'openai' | 'alibaba';

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
  const provider = process.env.AI_PROVIDER?.trim().toLowerCase() || 'coze';
  if (provider === 'coze' || provider === 'openai' || provider === 'alibaba') return provider;
  throw new AIProviderConfigError('AI_PROVIDER 只支持 coze、openai 或 alibaba');
}

function createCozeClient(requestHeaders: Headers | undefined, timeoutMs: number): TextProviderClient {
  const config = new Config({
    baseUrl: process.env.COZE_INTEGRATION_BASE_URL,
    modelBaseUrl: process.env.COZE_INTEGRATION_MODEL_BASE_URL,
    timeout: timeoutMs,
    retryTimes: 0,
  });

  try {
    config.validate();
  } catch {
    throw new AIProviderConfigError(
      'Coze AI 未配置，请设置 COZE_WORKLOAD_IDENTITY_API_KEY',
    );
  }

  if (!config.modelBaseUrl) {
    throw new AIProviderConfigError(
      'Coze AI 未配置，请设置 COZE_INTEGRATION_MODEL_BASE_URL',
    );
  }

  try {
    const modelUrl = new URL(config.modelBaseUrl);
    if (modelUrl.protocol !== 'http:' && modelUrl.protocol !== 'https:') throw new Error('invalid protocol');
  } catch {
    throw new AIProviderConfigError(
      'COZE_INTEGRATION_MODEL_BASE_URL 配置无效，请设置完整的 http(s) 地址',
    );
  }

  const client = new LLMClient(
    config,
    requestHeaders ? HeaderUtils.extractForwardHeaders(requestHeaders) : undefined,
  );

  return {
    async invoke(messages, options = {}) {
      const response = await client.invoke(messages, {
        temperature: options.temperature,
        thinking: options.thinking || 'disabled',
      });
      return { content: response.content?.toString() || '' };
    },
    async *stream(messages, options = {}) {
      const stream = client.stream(messages, {
        temperature: options.temperature,
        thinking: options.thinking || 'disabled',
      });
      for await (const chunk of stream) {
        yield { content: chunk.content?.toString() || '' };
      }
    },
  };
}

function createOpenAIClient(timeoutMs: number): TextProviderClient {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new AIProviderConfigError(
      'OpenAI AI 未配置，请设置 OPENAI_API_KEY',
    );
  }

  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-5-mini';
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
    timeout: timeoutMs,
    maxRetries: 0,
  });

  const input = (messages: TextMessage[]) => messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  return {
    async invoke(messages, options = {}) {
      const response = await client.responses.create({
        model,
        input: input(messages),
        store: false,
        text: options.responseFormat
          ? {
              format: {
                type: 'json_schema',
                name: options.responseFormat.name,
                strict: true,
                schema: options.responseFormat.schema,
              },
            }
          : undefined,
      });
      return { content: response.output_text || '' };
    },
    async *stream(messages, options = {}) {
      const stream = await client.responses.create({
        model,
        input: input(messages),
        store: false,
        stream: true,
        text: options.responseFormat
          ? {
              format: {
                type: 'json_schema',
                name: options.responseFormat.name,
                strict: true,
                schema: options.responseFormat.schema,
              },
            }
          : undefined,
      });
      for await (const event of stream) {
        if (event.type === 'response.output_text.delta') {
          yield { content: event.delta };
        }
      }
    },
  };
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
  const provider = getAIProvider();
  if (provider === 'openai') return createOpenAIClient(timeoutMs);
  if (provider === 'alibaba') return createAlibabaClient(timeoutMs);
  return createCozeClient(options.requestHeaders, timeoutMs);
}
