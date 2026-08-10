export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiProvider {
  completeJson(messages: AiChatMessage[]): Promise<Record<string, unknown>>;
}

export type AiProviderFactory = (headers?: Record<string, string>) => AiProvider;
