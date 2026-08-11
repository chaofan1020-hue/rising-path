import {
  getPersona,
  type Interviewer,
  type InterviewerArchetype,
} from './interviewers';

export interface InterviewerVoiceConfig {
  voice: string;
  speechRate: number;
  loudnessRate: number;
  pauseMs: number;
}

export type VoiceLanguage = 'zh' | 'en';

const ZH_VOICE_MAP: Record<InterviewerArchetype, { female: string[]; male: string[] }> = {
  ice_tech: {
    female: ['zh_female_mizai_saturn_bigtts', 'zh_female_vv_uranus_bigtts', 'zh_female_xiaohe_uranus_bigtts'],
    male: ['zh_male_m191_uranus_bigtts', 'saturn_zh_male_tiancaitongzhuo_tob', 'zh_male_dayi_saturn_bigtts'],
  },
  pressure_finance: {
    female: ['zh_female_jitangnv_saturn_bigtts', 'zh_female_vv_uranus_bigtts', 'zh_female_mizai_saturn_bigtts'],
    male: ['zh_male_dayi_saturn_bigtts', 'zh_male_taocheng_uranus_bigtts', 'zh_male_m191_uranus_bigtts'],
  },
  warm_mentor: {
    female: ['zh_female_santongyongns_saturn_bigtts', 'zh_female_xueayi_saturn_bigtts', 'saturn_zh_female_cancan_tob'],
    male: ['zh_male_ruyayichen_saturn_bigtts', 'zh_male_taocheng_uranus_bigtts', 'zh_male_m191_uranus_bigtts'],
  },
  creative_eclectic: {
    female: ['saturn_zh_female_cancan_tob', 'zh_female_jitangnv_saturn_bigtts', 'zh_female_xiaohe_uranus_bigtts'],
    male: ['saturn_zh_male_shuanglangshaonian_tob', 'saturn_zh_male_tiancaitongzhuo_tob', 'zh_male_ruyayichen_saturn_bigtts'],
  },
  culture_guardian: {
    female: ['zh_female_xiaohe_uranus_bigtts', 'saturn_zh_female_cancan_tob', 'zh_female_xueayi_saturn_bigtts'],
    male: ['zh_male_taocheng_uranus_bigtts', 'zh_male_ruyayichen_saturn_bigtts', 'zh_male_dayi_saturn_bigtts'],
  },
  silent_executive: {
    female: ['zh_female_vv_uranus_bigtts', 'zh_female_xueayi_saturn_bigtts', 'zh_female_mizai_saturn_bigtts'],
    male: ['saturn_zh_male_tiancaitongzhuo_tob', 'zh_male_m191_uranus_bigtts', 'zh_male_ruyayichen_saturn_bigtts'],
  },
};

const EN_VOICE_MAP: Record<InterviewerArchetype, { female: string[]; male: string[] }> = {
  ice_tech: {
    female: ['en_female_dacey_uranus_bigtts', 'en_female_stokie_uranus_bigtts'],
    male: ['en_male_tim_uranus_bigtts'],
  },
  pressure_finance: {
    female: ['en_female_dacey_uranus_bigtts', 'en_female_stokie_uranus_bigtts'],
    male: ['en_male_tim_uranus_bigtts'],
  },
  warm_mentor: {
    female: ['en_female_stokie_uranus_bigtts', 'en_female_dacey_uranus_bigtts'],
    male: ['en_male_tim_uranus_bigtts'],
  },
  creative_eclectic: {
    female: ['en_female_dacey_uranus_bigtts', 'en_female_stokie_uranus_bigtts'],
    male: ['en_male_tim_uranus_bigtts'],
  },
  culture_guardian: {
    female: ['en_female_stokie_uranus_bigtts', 'en_female_dacey_uranus_bigtts'],
    male: ['en_male_tim_uranus_bigtts'],
  },
  silent_executive: {
    female: ['en_female_stokie_uranus_bigtts', 'en_female_dacey_uranus_bigtts'],
    male: ['en_male_tim_uranus_bigtts'],
  },
};

const ZH_GENDER_POOLS: Record<'female' | 'male', string[]> = {
  female: [
    'zh_female_vv_uranus_bigtts',
    'zh_female_xiaohe_uranus_bigtts',
    'zh_female_mizai_saturn_bigtts',
    'zh_female_jitangnv_saturn_bigtts',
    'zh_female_santongyongns_saturn_bigtts',
    'saturn_zh_female_cancan_tob',
    'zh_female_xueayi_saturn_bigtts',
  ],
  male: [
    'zh_male_m191_uranus_bigtts',
    'zh_male_taocheng_uranus_bigtts',
    'zh_male_dayi_saturn_bigtts',
    'zh_male_ruyayichen_saturn_bigtts',
    'saturn_zh_male_shuanglangshaonian_tob',
    'saturn_zh_male_tiancaitongzhuo_tob',
  ],
};

const EN_GENDER_POOLS: Record<'female' | 'male', string[]> = {
  female: ['en_female_dacey_uranus_bigtts', 'en_female_stokie_uranus_bigtts'],
  male: ['en_male_tim_uranus_bigtts'],
};

const SPEECH_PROFILES: Record<InterviewerArchetype, Omit<InterviewerVoiceConfig, 'voice'>> = {
  ice_tech: { speechRate: -5, loudnessRate: 0, pauseMs: 240 },
  pressure_finance: { speechRate: 15, loudnessRate: 5, pauseMs: 160 },
  warm_mentor: { speechRate: 5, loudnessRate: 0, pauseMs: 280 },
  creative_eclectic: { speechRate: 10, loudnessRate: 2, pauseMs: 220 },
  culture_guardian: { speechRate: 0, loudnessRate: 0, pauseMs: 300 },
  silent_executive: { speechRate: -10, loudnessRate: 0, pauseMs: 420 },
};

function pickVoice(pool: string[], taken: Set<string>, fallbackPool: string[], id: number): string {
  let voice = pool.find((v) => !taken.has(v));
  if (!voice) voice = fallbackPool.find((v) => !taken.has(v));
  if (!voice) voice = fallbackPool[id % fallbackPool.length];
  taken.add(voice);
  return voice;
}

export function assignSessionVoiceConfigs(
  interviewers: Interviewer[],
  language: VoiceLanguage
): Map<number, InterviewerVoiceConfig> {
  const taken = new Set<string>();
  const assigned = new Map<number, InterviewerVoiceConfig>();
  const voiceMap = language === 'en' ? EN_VOICE_MAP : ZH_VOICE_MAP;
  const genderPools = language === 'en' ? EN_GENDER_POOLS : ZH_GENDER_POOLS;

  for (const it of interviewers) {
    const persona = getPersona(it.id);
    const gender = it.gender === 'female' ? 'female' : 'male';
    const prefs = voiceMap[persona.archetype][gender];
    const voice = pickVoice(prefs, taken, genderPools[gender], it.id);
    assigned.set(it.id, {
      voice,
      ...SPEECH_PROFILES[persona.archetype],
    });
  }
  return assigned;
}

export function getInterviewerVoiceConfig(
  it: Interviewer,
  language: VoiceLanguage,
  sessionInterviewers?: Interviewer[]
): InterviewerVoiceConfig {
  if (sessionInterviewers && sessionInterviewers.some((s) => s.id === it.id)) {
    const assigned = assignSessionVoiceConfigs(sessionInterviewers, language).get(it.id);
    if (assigned) return assigned;
  }
  const persona = getPersona(it.id);
  const gender = it.gender === 'female' ? 'female' : 'male';
  const voiceMap = language === 'en' ? EN_VOICE_MAP : ZH_VOICE_MAP;
  const genderPools = language === 'en' ? EN_GENDER_POOLS : ZH_GENDER_POOLS;
  const pool = voiceMap[persona.archetype][gender];
  const taken = new Set<string>();
  const voice = pickVoice(pool, taken, genderPools[gender], it.id);
  return {
    voice,
    ...SPEECH_PROFILES[persona.archetype],
  };
}
