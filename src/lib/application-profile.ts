import type { ResumeUserInfo } from '@/lib/resume-parser';
import type { ResumeProfile } from '@/lib/user-segmentation';

export interface ApplicationProfile {
  personal: Record<string, string>;
  links: Record<string, string>;
  education: Array<Record<string, string>>;
  experience: Array<Record<string, string>>;
  skills: string[];
  languages: string[];
  workAuthorization: string;
  visaStatus: string;
  summary: string;
}

export type ProfileSource = 'resume' | 'ai' | 'manual' | 'empty';

export interface ProfileFieldSource {
  source: ProfileSource;
  confidence: number;
  updatedAt?: string;
}

export type ProfileSourceMap = Record<string, ProfileFieldSource>;

export const DEFAULT_PROFILE: ApplicationProfile = {
  personal: {},
  links: {},
  education: [],
  experience: [],
  skills: [],
  languages: [],
  workAuthorization: '',
  visaStatus: '',
  summary: '',
};

function splitName(name?: string): { firstName: string; lastName: string } {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

export function buildProfileFromResume(
  userInfo: ResumeUserInfo | null | undefined,
  profile: ResumeProfile | null | undefined
): { profile: ApplicationProfile; source: ProfileSourceMap } {
  const info = userInfo || {};
  const name = info.name || '';
  const { firstName, lastName } = splitName(name);

  const profileData: ApplicationProfile = {
    personal: {
      firstName,
      lastName,
      fullName: name,
      email: info.email || '',
      phone: info.phone || '',
      address: '',
      city: '',
      state: '',
      zipCode: '',
      country: '',
    },
    links: {},
    education: (info.education || []).map((entry) => ({ raw: entry })),
    experience: (info.experience || []).map((entry) => ({ raw: entry })),
    skills: info.skills || [],
    languages: profile?.languages || [],
    workAuthorization: '',
    visaStatus: '',
    summary: profile?.meta ? '' : '',
  };

  const source: ProfileSourceMap = {};
  for (const key of Object.keys(profileData.personal)) {
    source[`personal.${key}`] = profileData.personal[key]
      ? { source: 'resume', confidence: 0.9 }
      : { source: 'empty', confidence: 0 };
  }
  source['education'] = profileData.education.length
    ? { source: 'resume', confidence: 0.9 }
    : { source: 'empty', confidence: 0 };
  source['experience'] = profileData.experience.length
    ? { source: 'resume', confidence: 0.9 }
    : { source: 'empty', confidence: 0 };
  source['skills'] = profileData.skills.length
    ? { source: 'resume', confidence: 0.9 }
    : { source: 'empty', confidence: 0 };

  return { profile: profileData, source };
}

export function mergeApplicationProfile(
  current: ApplicationProfile,
  updates: Partial<ApplicationProfile>,
  currentSource: ProfileSourceMap
): { profile: ApplicationProfile; source: ProfileSourceMap } {
  const profile = {
    ...current,
    ...updates,
    personal: { ...current.personal, ...(updates.personal || {}) },
    links: { ...current.links, ...(updates.links || {}) },
  };
  const source = { ...currentSource };
  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(updates.personal || {})) {
    source[`personal.${key}`] = value
      ? { source: 'manual', confidence: 1, updatedAt: now }
      : { source: 'empty', confidence: 0, updatedAt: now };
  }
  for (const key of ['skills', 'summary', 'workAuthorization', 'visaStatus', 'languages'] as const) {
    if (updates[key] !== undefined) {
      const value = updates[key];
      const filled = Array.isArray(value) ? value.length > 0 : Boolean(value);
      source[key] = filled
        ? { source: 'manual', confidence: 1, updatedAt: now }
        : { source: 'empty', confidence: 0, updatedAt: now };
    }
  }
  return { profile, source };
}
