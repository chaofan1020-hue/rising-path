import { Config, HeaderUtils, LLMClient } from 'coze-coding-dev-sdk';
import type { AiChatMessage, AiProvider, AiProviderFactory } from './types';

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  const raw = text.slice(start);
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    // 截断 JSON 时按最后一个完整对象字段做简单抢救
    const trimmed = raw.replace(/,\s*([}\]])/g, '$1');
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const createCozeAiProvider: AiProviderFactory = (headers) => {
  const customHeaders = HeaderUtils.extractForwardHeaders(headers || {});
  const client = new LLMClient(new Config(), customHeaders);

  return {
    async completeJson(messages: AiChatMessage[]): Promise<Record<string, unknown>> {
      let content = '';
      const stream = client.stream(messages, { temperature: 0.3 });
      for await (const chunk of stream) {
        if (chunk.content) content += chunk.content.toString();
      }
      const parsed = extractJson(content);
      if (!parsed) throw new Error('AI 输出不是有效 JSON');
      return parsed;
    },
  };
};
