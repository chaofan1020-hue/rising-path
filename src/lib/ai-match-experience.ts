import { parseExperience } from '@/lib/job-connectors/utils';

const CAMPUS_TITLE_PATTERN = /\b(intern|internship|co-?op|new\s+grad(?:uate)?|graduate)\b|实习|校招|应届/i;

type ExperienceJob = {
  title?: string | null;
  experience_min_years?: number | null;
  experience_text?: string | null;
  requirements?: string | null;
  description?: string | null;
};

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function clip(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length <= maximum ? text : text.slice(0, maximum);
}

export function hasCampusTitle(title?: string | null): boolean {
  return CAMPUS_TITLE_PATTERN.test(title || '');
}

/**
 * Resolve the applicant experience bar used for hard matching.
 * Structured `experience_min_years` wins unless a campus/intern title
 * inherited an implausible employer-history number. Otherwise parse the
 * posting text with the same official-field parser used by job connectors.
 */
export function jobExperienceMinYears(job: ExperienceJob): number | null {
  const stored = numberOrNull(job.experience_min_years);
  const campusTitle = hasCampusTitle(job.title);
  if (stored !== null && !(campusTitle && stored >= 8)) return stored;

  const parsed = parseExperience([
    clip(job.title, 180),
    clip(job.experience_text, 500),
    clip(job.requirements, 1600),
    clip(job.description, 1600),
  ]);
  if (parsed.min == null) return null;
  if (campusTitle && parsed.min >= 8) return null;
  return parsed.min;
}
