import type {
  OptimizationChange,
  OptimizedResumeData,
} from '@/lib/optimized-resume-contract';

const SECTION_ALIASES: Record<string, keyof OptimizedResumeData> = {
  contact: 'contact',
  summary: 'summary',
  skills: 'skills',
  experience: 'experience',
  education: 'education',
  projects: 'projects',
  certifications: 'certifications',
  '个人简介': 'summary',
  '专业技能': 'skills',
  '工作经历': 'experience',
  '教育背景': 'education',
  '项目经历': 'projects',
  '证书资质': 'certifications',
};

function replaceChangeText(value: unknown, change: OptimizationChange): unknown {
  if (typeof value === 'string') {
    if (value === change.after) return change.before;
    return value.includes(change.after)
      ? value.split(change.after).join(change.before)
      : value;
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (change.before === '' && item === change.after) return [];
      return [replaceChangeText(item, change)];
    });
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceChangeText(item, change)]),
    );
  }

  return value;
}

export function applyOptimizationChangeReview<T extends object>(
  base: T,
  changes: OptimizationChange[],
): T {
  let reviewed = JSON.parse(JSON.stringify(base)) as T;

  for (const change of changes) {
    if (change.status !== 'rejected') continue;
    const section = SECTION_ALIASES[change.section.trim().toLowerCase()];
    if (!section) continue;
    reviewed = {
      ...reviewed,
      [section]: replaceChangeText((reviewed as Record<string, unknown>)[section], change),
    } as T;
  }

  return reviewed;
}
