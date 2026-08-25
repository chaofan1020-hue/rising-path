export type InterviewASRProvider = 'alibaba' | 'cartesia_ink';
export type InterviewTTSProvider = 'alibaba' | 'cartesia_sonic';
export type InterviewVoiceRouteId = 'domestic_alibaba' | 'overseas_cartesia';
import { getTargetRegion, isExcludedRegion } from '@/lib/job-region-scope';

export interface InterviewVoiceRoute {
  id: InterviewVoiceRouteId;
  asrProvider: InterviewASRProvider;
  ttsProvider: InterviewTTSProvider;
  market: 'domestic' | 'overseas';
}

export const DOMESTIC_ALIBABA_VOICE_ROUTE: InterviewVoiceRoute = {
  id: 'domestic_alibaba',
  asrProvider: 'alibaba',
  ttsProvider: 'alibaba',
  market: 'domestic',
};

export const OVERSEAS_CARTESIA_VOICE_ROUTE: InterviewVoiceRoute = {
  id: 'overseas_cartesia',
  asrProvider: 'cartesia_ink',
  ttsProvider: 'cartesia_sonic',
  market: 'overseas',
};

const DOMESTIC_REGION_PATTERN = /(^|[^a-z])(cn|china|mainland)([^a-z]|$)|中国|国内|大陆|北上广深|北京|上海|广州|深圳|杭州|成都|武汉|南京|重庆|苏州|天津|西安|长沙|厦门|郑州|合肥|青岛/iu;
const OVERSEAS_REGION_PATTERN = /(^|[^a-z])(us|usa|united states|north america|uk|united kingdom|england|sg|singapore|ca|canada|hk|hong kong|au|australia)([^a-z]|$)|美国|北美|英国|新加坡|加拿大|香港|澳大利亚|澳洲|多伦多|温哥华|伦敦|悉尼|墨尔本/iu;

export function resolveInterviewVoiceRoute(region: unknown): InterviewVoiceRoute {
  const normalized = typeof region === 'string' ? region.trim() : '';
  if (DOMESTIC_REGION_PATTERN.test(normalized)) return DOMESTIC_ALIBABA_VOICE_ROUTE;
  if (
    OVERSEAS_REGION_PATTERN.test(normalized)
    || getTargetRegion(normalized, '') !== null
    || isExcludedRegion(normalized, '')
  ) return OVERSEAS_CARTESIA_VOICE_ROUTE;
  // The current catalog is overseas-first. Keep unknown or incomplete records
  // on the Cartesia path until a future China-market job is explicitly marked.
  return OVERSEAS_CARTESIA_VOICE_ROUTE;
}

export function parseInterviewVoiceRoute(value: unknown): InterviewVoiceRoute | null {
  if (value === OVERSEAS_CARTESIA_VOICE_ROUTE.id) return OVERSEAS_CARTESIA_VOICE_ROUTE;
  if (value === DOMESTIC_ALIBABA_VOICE_ROUTE.id) return DOMESTIC_ALIBABA_VOICE_ROUTE;
  return null;
}

export function getEffectiveInterviewTTSProvider(route: InterviewVoiceRoute): {
  provider: InterviewTTSProvider;
  fallback: boolean;
  fallbackReason: string | null;
} {
  if (route.ttsProvider !== 'alibaba') {
    return { provider: route.ttsProvider, fallback: false, fallbackReason: null };
  }

  // Alibaba TTS credentials and endpoint are intentionally opt-in. Until the
  // domestic implementation is enabled, retain the existing Sonic playback so
  // China-market interviews continue to work instead of silently failing.
  if (process.env.ALIBABA_TTS_ENABLED?.trim().toLowerCase() === 'true') {
    return { provider: 'alibaba', fallback: false, fallbackReason: null };
  }
  return {
    provider: 'cartesia_sonic',
    fallback: true,
    fallbackReason: 'alibaba_tts_not_enabled',
  };
}
