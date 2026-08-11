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
  editCount?: number;
  confirmCount?: number;
  ignoreCount?: number;
}

export type ProfileSourceMap = Record<string, ProfileFieldSource>;

export interface ProfileChange {
  fieldKey: string;
  oldValue: string;
  newValue: string;
}

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
): { profile: ApplicationProfile; source: ProfileSourceMap; changes: ProfileChange[] } {
  const profile = {
    ...current,
    ...updates,
    personal: { ...current.personal, ...(updates.personal || {}) },
    links: { ...current.links, ...(updates.links || {}) },
  };
  const source = { ...currentSource };
  const now = new Date().toISOString();
  const changes: ProfileChange[] = [];
  for (const [key, value] of Object.entries(updates.personal || {})) {
    const oldValue = current.personal[key] || '';
    const newValue = String(value || '');
    if (oldValue !== newValue) {
      changes.push({ fieldKey: `personal.${key}`, oldValue, newValue });
    }
    source[`personal.${key}`] = value
      ? {
          source: 'manual',
          confidence: 1,
          updatedAt: now,
          editCount: (source[`personal.${key}`]?.editCount || 0) + (oldValue !== newValue ? 1 : 0),
          confirmCount: source[`personal.${key}`]?.confirmCount || 0,
          ignoreCount: source[`personal.${key}`]?.ignoreCount || 0,
        }
      : {
          source: 'empty',
          confidence: 0,
          updatedAt: now,
          editCount: source[`personal.${key}`]?.editCount || 0,
          ignoreCount: source[`personal.${key}`]?.ignoreCount || 0,
        };
  }
  for (const key of ['skills', 'summary', 'workAuthorization', 'visaStatus', 'languages'] as const) {
    if (updates[key] !== undefined) {
      const value = updates[key];
      const oldValue = Array.isArray(current[key]) ? JSON.stringify(current[key]) : String(current[key] || '');
      const newValue = Array.isArray(value) ? JSON.stringify(value) : String(value || '');
      if (oldValue !== newValue) {
        changes.push({ fieldKey: key, oldValue, newValue });
      }
      const filled = Array.isArray(value) ? value.length > 0 : Boolean(value);
      source[key] = filled
        ? {
            source: 'manual',
            confidence: 1,
            updatedAt: now,
            editCount: (source[key]?.editCount || 0) + (oldValue !== newValue ? 1 : 0),
            confirmCount: source[key]?.confirmCount || 0,
            ignoreCount: source[key]?.ignoreCount || 0,
          }
        : {
            source: 'empty',
            confidence: 0,
            updatedAt: now,
            editCount: source[key]?.editCount || 0,
            ignoreCount: source[key]?.ignoreCount || 0,
          };
    }
  }
  return { profile, source, changes };
}

export function setProfileValueBySemanticKey(
  profile: ApplicationProfile,
  semanticKey: string,
  value: string
): ApplicationProfile {
  const next = {
    ...profile,
    personal: { ...profile.personal },
    links: { ...profile.links },
  };
  const personalKeys: Record<string, keyof ApplicationProfile['personal']> = {
    first_name: 'firstName',
    last_name: 'lastName',
    full_name: 'fullName',
    email: 'email',
    phone: 'phone',
    address: 'address',
    city: 'city',
    state: 'state',
    zip_code: 'zipCode',
    country: 'country',
  };
  if (personalKeys[semanticKey]) {
    next.personal[personalKeys[semanticKey]] = value;
  } else if (semanticKey === 'linkedin' || semanticKey === 'github' || semanticKey === 'portfolio') {
    next.links[semanticKey] = value;
  } else if (semanticKey === 'work_authorization') {
    next.workAuthorization = value;
  } else if (semanticKey === 'visa_status') {
    next.visaStatus = value;
  } else if (semanticKey === 'summary') {
    next.summary = value;
  } else if (semanticKey === 'skills') {
    next.skills = value.split(',').map((s) => s.trim()).filter(Boolean);
  } else if (semanticKey === 'languages') {
    next.languages = value.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return next;
}

export function bumpFieldStats(
  source: ProfileSourceMap,
  fieldKey: string,
  kind: 'edit' | 'confirm' | 'ignore'
): ProfileSourceMap {
  const current = source[fieldKey] || { source: 'empty' as const, confidence: 0 };
  if (kind === 'ignore') {
    return {
      ...source,
      [fieldKey]: {
        ...current,
        source: 'empty',
        confidence: Math.min(current.confidence || 0.5, 0.3),
        updatedAt: new Date().toISOString(),
        ignoreCount: (current.ignoreCount || 0) + 1,
      },
    };
  }
  return {
    ...source,
    [fieldKey]: {
      ...current,
      source: 'manual',
      confidence: 1,
      updatedAt: new Date().toISOString(),
      editCount: (current.editCount || 0) + (kind === 'edit' ? 1 : 0),
      confirmCount: (current.confirmCount || 0) + (kind === 'confirm' ? 1 : 0),
      ignoreCount: current.ignoreCount || 0,
    },
  };
}
