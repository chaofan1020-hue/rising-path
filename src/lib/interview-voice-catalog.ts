import type { InterviewVoiceStyle } from './interview-company-context';
import type { InterviewerArchetype } from './interviewers';

export type VoiceLanguage = 'zh' | 'en';
export type VoiceGender = 'female' | 'male';

export interface CatalogVoice {
  id: string;
  gender: VoiceGender;
  styles: InterviewVoiceStyle[];
}

// These are Cartesia voice IDs, not provider-specific aliases. Keeping the
// catalog here prevents a semantic interviewer voice from silently falling
// back to CARTESIA_VOICE_ZH / CARTESIA_VOICE_EN for every response.
const CATALOG: Record<VoiceLanguage, CatalogVoice[]> = {
  zh: [
    { id: '6eb8965c-e295-47bd-a9e4-3eeebb3abcff', gender: 'female', styles: ['balanced', 'warm', 'analytical'] },
    { id: '7a5d4663-88ae-47b7-808e-8f9b9ee4127b', gender: 'female', styles: ['warm', 'creative', 'balanced'] },
    { id: 'bf32f849-7bc9-4b91-8c62-954588efcc30', gender: 'female', styles: ['analytical', 'executive', 'balanced'] },
    { id: 'f9a4b3a6-b44b-469f-90e3-c8e19bd30e99', gender: 'female', styles: ['analytical', 'direct'] },
    { id: 'a53c3509-ec3f-425c-a223-977f5f7424dd', gender: 'female', styles: ['creative', 'warm'] },
    { id: '51afbb31-bc56-468d-b122-4f388b7c25d9', gender: 'male', styles: ['warm', 'balanced'] },
    { id: 'eda5bbff-1ff1-4886-8ef1-4e69a77640a0', gender: 'male', styles: ['direct', 'executive'] },
    { id: 'c59c247b-6aa9-4ab6-91f9-9eabea7dc69e', gender: 'male', styles: ['analytical', 'executive'] },
    { id: '653b9445-ae0c-4312-a3ce-375504cff31e', gender: 'male', styles: ['balanced', 'direct'] },
    { id: '7e2a44d1-76b8-42b8-9507-fedfe3a803c8', gender: 'male', styles: ['direct', 'analytical'] },
    { id: '16212f18-4955-4be9-a6cd-2196ce2c11d1', gender: 'male', styles: ['warm', 'creative'] },
  ],
  en: [
    { id: 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4', gender: 'female', styles: ['warm', 'balanced', 'creative'] },
    { id: '62ae83ad-4f6a-430b-af41-a9bede9286ca', gender: 'female', styles: ['direct', 'analytical'] },
    { id: '829ccd10-f8b3-43cd-b8a0-4aeaa81f3b30', gender: 'female', styles: ['warm', 'balanced', 'executive'] },
    { id: '47c38ca4-5f35-497b-b1a3-415245fb35e1', gender: 'male', styles: ['analytical', 'balanced'] },
    { id: 'b24f41fd-00a3-4cd8-992a-a0c9f13f3ef1', gender: 'male', styles: ['executive', 'analytical'] },
    { id: 'aa2cafe9-97ba-4052-ac3c-875000f95212', gender: 'male', styles: ['executive', 'balanced'] },
    { id: '5568a7df-e5ab-4442-9fae-2e9ba1b15ad8', gender: 'male', styles: ['creative', 'warm'] },
    { id: '5ee9feff-1265-424a-9d7f-8e4d431a12c7', gender: 'male', styles: ['analytical', 'direct'] },
    { id: '79f8b5fb-2cc8-479a-80df-29f7a7cf1a3e', gender: 'male', styles: ['balanced', 'creative'] },
  ],
};

const ARCHETYPE_STYLE: Record<InterviewerArchetype, InterviewVoiceStyle> = {
  ice_tech: 'analytical',
  pressure_finance: 'direct',
  warm_mentor: 'warm',
  creative_eclectic: 'creative',
  culture_guardian: 'balanced',
  silent_executive: 'executive',
};

function configuredVoice(language: VoiceLanguage, style: InterviewVoiceStyle, gender: VoiceGender, slot: number): string | null {
  const prefix = `CARTESIA_VOICE_${language.toUpperCase()}_${style.toUpperCase()}_${gender.toUpperCase()}`;
  return process.env[`${prefix}_${slot + 1}`]?.trim()
    || process.env[prefix]?.trim()
    || process.env[`CARTESIA_VOICE_${language.toUpperCase()}_${style.toUpperCase()}`]?.trim()
    || null;
}

export function selectInterviewVoice(input: {
  language: VoiceLanguage;
  style: InterviewVoiceStyle;
  archetype: InterviewerArchetype;
  gender: VoiceGender;
  interviewerId: number;
  slot: number;
  taken: Set<string>;
}): string {
  const { language, style, archetype, gender, interviewerId, slot, taken } = input;
  const configured = configuredVoice(language, style, gender, slot);
  if (configured && !taken.has(configured)) return configured;

  const preferredStyle = style === 'balanced' ? ARCHETYPE_STYLE[archetype] : style;
  const voices = CATALOG[language];
  const ranked = [
    ...voices.filter((voice) => voice.gender === gender && voice.styles.includes(preferredStyle)),
    ...voices.filter((voice) => voice.gender === gender),
    ...voices.filter((voice) => voice.styles.includes(preferredStyle)),
    ...voices,
  ];
  const unique = [...new Map(ranked.map((voice) => [voice.id, voice])).values()];
  const available = unique.filter((voice) => !taken.has(voice.id));
  return (available[slot % available.length] || unique[interviewerId % unique.length]).id;
}
