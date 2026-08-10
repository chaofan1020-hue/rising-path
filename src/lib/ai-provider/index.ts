import { createCozeAiProvider } from './coze';
import type { AiProvider, AiProviderFactory } from './types';

const PROVIDERS: Record<string, AiProviderFactory> = {
  coze: createCozeAiProvider,
};

export function createAiProvider(
  headers?: Record<string, string>,
  providerName = process.env.AI_PROVIDER || 'coze'
): AiProvider {
  const factory = PROVIDERS[providerName];
  if (!factory) throw new Error(`Unsupported AI provider: ${providerName}`);
  return factory(headers);
}

export type { AiChatMessage, AiProvider, AiProviderFactory } from './types';
