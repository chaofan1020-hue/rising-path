import { getPersona, type Interviewer, type InterviewerArchetype } from './interviewers';
import type { InterviewVoiceSource, InterviewVoiceStyle } from './interview-company-context';
import { selectInterviewVoice, type VoiceLanguage } from './interview-voice-catalog';

export interface InterviewerVoiceConfig {
  voice: string;
  speechRate: number;
  loudnessRate: number;
  pauseMs: number;
  voiceStyle: InterviewVoiceStyle;
  voiceSource: InterviewVoiceSource;
}

export type { VoiceLanguage } from './interview-voice-catalog';

const SPEECH_PROFILES: Record<InterviewerArchetype, Omit<InterviewerVoiceConfig, 'voice'>> = {
  ice_tech: { speechRate: -5, loudnessRate: 0, pauseMs: 240, voiceStyle: 'analytical', voiceSource: 'job_fallback' },
  pressure_finance: { speechRate: 15, loudnessRate: 5, pauseMs: 160, voiceStyle: 'direct', voiceSource: 'job_fallback' },
  warm_mentor: { speechRate: 5, loudnessRate: 0, pauseMs: 280, voiceStyle: 'warm', voiceSource: 'job_fallback' },
  creative_eclectic: { speechRate: 10, loudnessRate: 2, pauseMs: 220, voiceStyle: 'creative', voiceSource: 'job_fallback' },
  culture_guardian: { speechRate: 0, loudnessRate: 0, pauseMs: 300, voiceStyle: 'balanced', voiceSource: 'job_fallback' },
  silent_executive: { speechRate: -10, loudnessRate: 0, pauseMs: 420, voiceStyle: 'executive', voiceSource: 'job_fallback' },
};

export function assignSessionVoiceConfigs(
  interviewers: Interviewer[],
  language: VoiceLanguage,
  companyVoice?: { style: InterviewVoiceStyle; source: InterviewVoiceSource },
): Map<number, InterviewerVoiceConfig> {
  const taken = new Set<string>();
  const assigned = new Map<number, InterviewerVoiceConfig>();
  for (const [slot, interviewer] of interviewers.entries()) {
    const persona = getPersona(interviewer.id);
    const style = companyVoice?.style ?? SPEECH_PROFILES[persona.archetype].voiceStyle;
    const gender = interviewer.gender === 'female' ? 'female' : 'male';
    const voice = selectInterviewVoice({ language, style, archetype: persona.archetype, gender, interviewerId: interviewer.id, slot, taken });
    taken.add(voice);
    assigned.set(interviewer.id, {
      voice: `cartesia:${voice}`,
      ...SPEECH_PROFILES[persona.archetype],
      voiceStyle: style,
      voiceSource: companyVoice?.source ?? 'job_fallback',
    });
  }
  return assigned;
}

export function getInterviewerVoiceConfig(
  interviewer: Interviewer,
  language: VoiceLanguage,
  sessionInterviewers?: Interviewer[],
  companyVoice?: { style: InterviewVoiceStyle; source: InterviewVoiceSource },
): InterviewerVoiceConfig {
  const session = sessionInterviewers?.length ? sessionInterviewers : [interviewer];
  return assignSessionVoiceConfigs(session, language, companyVoice).get(interviewer.id)
    || assignSessionVoiceConfigs([interviewer], language, companyVoice).get(interviewer.id)!;
}
