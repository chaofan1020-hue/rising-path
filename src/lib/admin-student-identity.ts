import type { RegionKey } from '@/lib/region-dna';
import type { CareerStage } from '@/lib/resume-types';

export const STUDENT_PUBLIC_CODE_PATTERN = /^LV-[0-9A-F]{8}$/i;

const REGION_LABELS: Record<string, string> = {
  us: '美国',
  uk: '英国',
  sg: '新加坡',
  cn_t1: '国内一线',
  cn_t2: '国内二三线',
  ca: '加拿大',
  hk: '香港',
  au: '澳洲',
};

const STAGE_LABELS: Record<string, string> = {
  junior: '低年级',
  senior: '高年级',
  experienced: '社招',
  returning_intern: '返实习',
};

export function studentPublicCode(userId: string): string {
  return `LV-${userId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export function regionLabel(region: string | null | undefined): string {
  if (!region) return '';
  return REGION_LABELS[region] || region;
}

export function careerStageLabel(stage: string | null | undefined): string {
  if (!stage) return '';
  return STAGE_LABELS[stage] || stage;
}

function cleanName(value: string | null | undefined): string {
  const trimmed = value?.trim() || '';
  if (!trimmed || trimmed === '未命名用户' || trimmed === '未设置姓名') return '';
  return trimmed;
}

export function studentEmailHandle(
  emailLocal?: string | null,
  emailDomain?: string | null,
): string {
  const local = emailLocal?.trim() || '';
  const domain = emailDomain?.trim() || '';
  if (!local) return '';
  return domain ? `${local}@${domain}` : local;
}

export function resolveStudentDisplayName(input: {
  displayName?: string | null;
  resumeName?: string | null;
  emailLocal?: string | null;
  publicCode?: string | null;
}): { name: string; source: 'profile' | 'resume' | 'email' | 'code' | 'unknown' } {
  const profileName = cleanName(input.displayName);
  if (profileName) return { name: profileName, source: 'profile' };
  const resumeName = cleanName(input.resumeName);
  if (resumeName) return { name: resumeName, source: 'resume' };
  const emailLocal = input.emailLocal?.trim();
  if (emailLocal) return { name: emailLocal, source: 'email' };
  if (input.publicCode) return { name: input.publicCode, source: 'code' };
  return { name: '未设置姓名', source: 'unknown' };
}

export function studentDisplayName(name: string | null | undefined): string {
  return cleanName(name) || '未设置姓名';
}

export function studentInitial(name: string | null | undefined): string {
  const display = studentDisplayName(name);
  if (display === '未设置姓名') return '?';
  if (/^LV-/i.test(display)) return 'L';
  return Array.from(display)[0]?.toUpperCase() || '?';
}

export type AdminStudentIdentity = {
  userId: string;
  publicCode: string;
  displayName: string;
  nameSource?: 'profile' | 'resume' | 'email' | 'code' | 'unknown';
  emailHandle?: string | null;
  avatarUrl?: string | null;
  schoolName?: string | null;
  preferredRegion?: RegionKey | string | null;
  careerStage?: CareerStage | string | null;
};

export function identityFromDirectoryRow(row: {
  user_id: string;
  public_code?: string | null;
  display_name?: string | null;
  resume_name?: string | null;
  email_local?: string | null;
  email_domain?: string | null;
  avatar_url?: string | null;
  school_name?: string | null;
  preferred_region?: string | null;
  career_stage?: string | null;
}): AdminStudentIdentity {
  const publicCode = row.public_code || studentPublicCode(row.user_id);
  const resolved = resolveStudentDisplayName({
    displayName: row.display_name,
    resumeName: row.resume_name,
    emailLocal: row.email_local,
    publicCode,
  });
  return {
    userId: row.user_id,
    publicCode,
    displayName: resolved.name,
    nameSource: resolved.source,
    emailHandle: studentEmailHandle(row.email_local, row.email_domain),
    avatarUrl: row.avatar_url,
    schoolName: row.school_name,
    preferredRegion: row.preferred_region,
    careerStage: row.career_stage,
  };
}
