import type { ResumeUserInfo } from '@/lib/resume-parser';
import type { ResumeProfile } from '@/lib/user-segmentation';
import { resolveRegionKey } from '@/lib/region-dna';
import { resolveVisaStatusForRegion } from '@/lib/visa-timeline';

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

const semanticSourceKeys: Record<string, string> = {
  first_name: 'personal.firstName',
  last_name: 'personal.lastName',
  full_name: 'personal.fullName',
  email: 'personal.email',
  phone: 'personal.phone',
  address: 'personal.address',
  city: 'personal.city',
  state: 'personal.state',
  zip_code: 'personal.zipCode',
  country: 'personal.country',
  linkedin: 'links.linkedin',
  github: 'links.github',
  portfolio: 'links.portfolio',
  work_authorization: 'workAuthorization',
  visa_status: 'visaStatus',
  summary: 'summary',
  skills: 'skills',
  languages: 'languages',
};

export function sourceKeyForSemanticKey(semanticKey: string): string {
  return semanticSourceKeys[semanticKey] || semanticKey;
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeRawEntry(value: unknown): Record<string, string> {
  if (!isRecord(value)) return { raw: '' };
  if (typeof value.raw === 'string' && value.raw.trim()) return { raw: value.raw.trim() };
  const parts = [
    'school', 'degree', 'major', 'company', 'role', 'title',
    'startDate', 'endDate', 'description', 'highlights',
  ].map((key) => typeof value[key] === 'string' ? value[key] as string : undefined)
    .filter((item): item is string => Boolean(item?.trim()));
  return { raw: parts.join(' | ') };
}

function stringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => item.trim());
  return items.length > 0 ? items : fallback;
}

export function normalizeAiProfile(
  raw: unknown,
  fallback: ApplicationProfile = DEFAULT_PROFILE,
): ApplicationProfile {
  const source = isRecord(raw) ? raw : {};
  const personal = isRecord(source.personal) ? source.personal : {};
  const links = isRecord(source.links) ? source.links : {};
  const fallbackPersonal = fallback.personal || {};
  const fallbackLinks = fallback.links || {};

  const personalKeys = [
    'firstName', 'lastName', 'fullName', 'email', 'phone',
    'address', 'city', 'state', 'zipCode', 'country',
  ] as const;
  const linkKeys = ['linkedin', 'github', 'portfolio'] as const;

  const normalizedPersonal = Object.fromEntries(
    personalKeys.map((key) => [
      key,
      typeof personal[key] === 'string' && personal[key].trim()
        ? (personal[key] as string).trim()
        : (fallbackPersonal[key] || ''),
    ]),
  );
  const normalizedLinks = Object.fromEntries(
    linkKeys.map((key) => [
      key,
      typeof links[key] === 'string' && links[key].trim()
        ? (links[key] as string).trim()
        : (fallbackLinks[key] || ''),
    ]),
  );

  const education = Array.isArray(source.education)
    ? source.education.map(normalizeRawEntry).filter((entry) => entry.raw)
    : [];
  const experience = Array.isArray(source.experience)
    ? source.experience.map(normalizeRawEntry).filter((entry) => entry.raw)
    : [];

  return {
    personal: normalizedPersonal,
    links: normalizedLinks,
    education: education.length > 0 ? education : (fallback.education || []),
    experience: experience.length > 0 ? experience : (fallback.experience || []),
    skills: stringArray(source.skills, fallback.skills || []),
    languages: stringArray(source.languages, fallback.languages || []),
    workAuthorization: typeof source.workAuthorization === 'string'
      ? source.workAuthorization.trim()
      : (fallback.workAuthorization || ''),
    visaStatus: typeof source.visaStatus === 'string'
      ? source.visaStatus.trim()
      : (fallback.visaStatus || ''),
    summary: typeof source.summary === 'string'
      ? source.summary.trim()
      : (fallback.summary || ''),
  };
}

export function buildSourceMapFromProfile(profile: ApplicationProfile): ProfileSourceMap {
  const source: ProfileSourceMap = {};
  const ai = (value: unknown): ProfileFieldSource => value
    ? { source: 'ai', confidence: 0.8 }
    : { source: 'empty', confidence: 0 };

  for (const [key, value] of Object.entries(profile.personal || {})) {
    source[`personal.${key}`] = ai(value);
  }
  for (const [key, value] of Object.entries(profile.links || {})) {
    source[`links.${key}`] = ai(value);
  }
  source.education = ai(profile.education?.length);
  source.experience = ai(profile.experience?.length);
  source.skills = ai(profile.skills?.length);
  source.languages = ai(profile.languages?.length);
  source.workAuthorization = ai(profile.workAuthorization);
  source.visaStatus = ai(profile.visaStatus);
  source.summary = ai(profile.summary);
  return source;
}

/** Preserve values the user explicitly edited when AI regenerates a profile. */
export function mergeAiProfilePreservingManual(
  aiProfile: ApplicationProfile,
  currentProfile: ApplicationProfile,
  currentSource: ProfileSourceMap,
): { profile: ApplicationProfile; source: ProfileSourceMap } {
  const profile: ApplicationProfile = {
    ...aiProfile,
    personal: { ...aiProfile.personal },
    links: { ...aiProfile.links },
  };
  const manualValues: Record<string, unknown> = {
    'personal.firstName': currentProfile.personal?.firstName,
    'personal.lastName': currentProfile.personal?.lastName,
    'personal.fullName': currentProfile.personal?.fullName,
    'personal.email': currentProfile.personal?.email,
    'personal.phone': currentProfile.personal?.phone,
    'personal.address': currentProfile.personal?.address,
    'personal.city': currentProfile.personal?.city,
    'personal.state': currentProfile.personal?.state,
    'personal.zipCode': currentProfile.personal?.zipCode,
    'personal.country': currentProfile.personal?.country,
    'links.linkedin': currentProfile.links?.linkedin,
    'links.github': currentProfile.links?.github,
    'links.portfolio': currentProfile.links?.portfolio,
    education: currentProfile.education,
    experience: currentProfile.experience,
    skills: currentProfile.skills,
    languages: currentProfile.languages,
    workAuthorization: currentProfile.workAuthorization,
    visaStatus: currentProfile.visaStatus,
    summary: currentProfile.summary,
  };

  for (const [key, source] of Object.entries(currentSource)) {
    if (source.source !== 'manual' || !(key in manualValues)) continue;
    const value = manualValues[key];
    if (key.startsWith('personal.')) {
      profile.personal[key.slice('personal.'.length)] = String(value || '');
    } else if (key.startsWith('links.')) {
      profile.links[key.slice('links.'.length)] = String(value || '');
    } else if (key === 'education' || key === 'experience') {
      const entries = Array.isArray(value) ? value as Array<Record<string, string>> : [];
      if (key === 'education') profile.education = entries;
      else profile.experience = entries;
    } else if (key === 'skills' || key === 'languages') {
      const values = Array.isArray(value) ? value as string[] : [];
      if (key === 'skills') profile.skills = values;
      else profile.languages = values;
    } else if (key === 'workAuthorization' || key === 'visaStatus' || key === 'summary') {
      profile[key] = String(value || '');
    }
  }

  const source = buildSourceMapFromProfile(profile);
  for (const [key, fieldSource] of Object.entries(currentSource)) {
    if (fieldSource.source === 'manual') source[key] = fieldSource;
  }
  return { profile, source };
}

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
  const primaryRegion = (profile?.intention?.locations || [])
    .map((location) => resolveRegionKey(location))
    .find(Boolean) ?? null;

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
    workAuthorization: profile?.intention?.workAuthorization || '',
    visaStatus: (primaryRegion
      ? resolveVisaStatusForRegion(profile?.intention, primaryRegion)
      : profile?.intention?.visaStatus) || '',
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
  source['languages'] = profileData.languages.length
    ? { source: 'resume', confidence: 0.9 }
    : { source: 'empty', confidence: 0 };
  source['workAuthorization'] = profileData.workAuthorization
    ? { source: 'resume', confidence: 0.9 }
    : { source: 'empty', confidence: 0 };
  source['visaStatus'] = profileData.visaStatus
    ? { source: 'resume', confidence: 0.9 }
    : { source: 'empty', confidence: 0 };
  source['summary'] = profileData.summary
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
  for (const [key, value] of Object.entries(updates.links || {})) {
    const oldValue = current.links[key] || '';
    const newValue = String(value || '');
    if (oldValue !== newValue) {
      changes.push({ fieldKey: `links.${key}`, oldValue, newValue });
    }
    source[`links.${key}`] = value
      ? {
          source: 'manual',
          confidence: 1,
          updatedAt: now,
          editCount: (source[`links.${key}`]?.editCount || 0) + (oldValue !== newValue ? 1 : 0),
          confirmCount: source[`links.${key}`]?.confirmCount || 0,
          ignoreCount: source[`links.${key}`]?.ignoreCount || 0,
        }
      : {
          source: 'empty',
          confidence: 0,
          updatedAt: now,
          editCount: source[`links.${key}`]?.editCount || 0,
          ignoreCount: source[`links.${key}`]?.ignoreCount || 0,
        };
  }
  for (const key of ['education', 'experience'] as const) {
    if (updates[key] !== undefined) {
      const oldValue = JSON.stringify(current[key] || []);
      const newValue = JSON.stringify(updates[key] || []);
      if (oldValue !== newValue) {
        changes.push({ fieldKey: key, oldValue, newValue });
      }
      const filled = (updates[key] || []).length > 0;
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
