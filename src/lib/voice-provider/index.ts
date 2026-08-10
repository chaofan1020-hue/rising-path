import { createCozeVoiceProvider } from './coze';
import type { VoiceProvider, VoiceProviderFactory } from './types';

// 新增语音供应商时：在 src/lib/voice-provider 下实现 VoiceProvider，
// 在这里注册，并把环境变量 VOICE_PROVIDER 切到对应 key 即可，业务路由无需改动。
const PROVIDERS: Record<string, VoiceProviderFactory> = {
  coze: createCozeVoiceProvider,
};

export function createVoiceProvider(
  headers?: Record<string, string>,
  providerName = process.env.VOICE_PROVIDER || 'coze'
): VoiceProvider {
  const factory = PROVIDERS[providerName];
  if (!factory) {
    throw new Error(`Unsupported voice provider: ${providerName}`);
  }
  return factory(headers);
}

export type {
  VoiceProvider,
  VoiceProviderFactory,
  VoiceSynthesizeRequest,
  VoiceSynthesizeResult,
  VoiceTranscribeRequest,
  VoiceTranscribeResult,
} from './types';
