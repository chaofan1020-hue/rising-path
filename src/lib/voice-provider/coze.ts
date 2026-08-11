import { ASRClient, Config, HeaderUtils, TTSClient } from 'coze-coding-dev-sdk';
import type {
  VoiceProviderFactory,
  VoiceSynthesizeRequest,
  VoiceSynthesizeResult,
  VoiceTranscribeRequest,
  VoiceTranscribeResult,
} from './types';

const SPEAKER_ZH = 'zh_female_xiaohe_uranus_bigtts';
const SPEAKER_EN = 'en_female_dacey_uranus_bigtts';
const SPEAKER_EN_FALLBACK = 'zh_female_vv_uranus_bigtts';

function clamp(value: number | undefined, min: number, max: number, fallback = 0): number {
  return typeof value === 'number' && value >= min && value <= max ? Math.round(value) : fallback;
}

function isSilenceError(message: string): boolean {
  return (
    message.includes('no valid speech') ||
    message.includes('silence') ||
    message.includes('20000003') ||
    message.includes('empty audio') ||
    message.includes('invalid argument')
  );
}

export const createCozeVoiceProvider: VoiceProviderFactory = (headers) => {
  const config = new Config();
  const customHeaders = HeaderUtils.extractForwardHeaders(headers || {});

  return {
    async synthesize(request: VoiceSynthesizeRequest): Promise<VoiceSynthesizeResult> {
      const ttsClient = new TTSClient(config, customHeaders);
      const speakerId = request.voice || (request.language === 'en' ? SPEAKER_EN : SPEAKER_ZH);
      const params = {
        uid: request.uid || 'interview',
        text: request.text.slice(0, 1000),
        speaker: speakerId,
        audioFormat: 'mp3' as const,
        sampleRate: 48000 as const,
        speechRate: clamp(request.speechRate, -50, 100),
        loudnessRate: clamp(request.loudnessRate, -50, 100),
      };

      let response;
      try {
        response = await ttsClient.synthesize(params);
      } catch (error) {
        if (request.language === 'en' && speakerId !== SPEAKER_EN_FALLBACK) {
          console.warn(`English TTS voice unavailable (${speakerId}), falling back to bilingual voice`);
          response = await ttsClient.synthesize({ ...params, speaker: SPEAKER_EN_FALLBACK });
        } else {
          throw error;
        }
      }

      const audioRes = await fetch(response.audioUri);
      if (!audioRes.ok) throw new Error('音频下载失败');
      const audio = Buffer.from(await audioRes.arrayBuffer());
      return { audio, contentType: 'audio/mpeg' };
    },

    async transcribe(request: VoiceTranscribeRequest): Promise<VoiceTranscribeResult> {
      const asrClient = new ASRClient(config, customHeaders);
      try {
        const result = await asrClient.recognize({
          uid: request.uid || 'interview',
          base64Data: request.audioBase64,
        });
        return { text: result.text };
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (isSilenceError(message)) {
          return { text: '', silence: true };
        }
        throw error;
      }
    },
  };
};
