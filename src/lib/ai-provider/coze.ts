import { Config, HeaderUtils, LLMClient } from 'coze-coding-dev-sdk';
import type { AiChatMessage, AiProvider, AiProviderFactory } from './types';
import { extractFirstJsonObject } from '../json-extract';

function extractJson(text: string): Record<string, unknown> | null {
  const parsed = extractFirstJsonObject(text);
  return isRecord(parsed) ? parsed : null;
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
