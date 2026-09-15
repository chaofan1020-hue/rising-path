import { isActiveResumeProcessing } from '@/lib/resume-types';

export interface ResumeAvailabilityItem {
  id: number;
  processing_status?: string | null;
  segmentation_confirmed?: boolean | null;
}

export type ResumeAvailabilityStatus = 'none' | 'processing' | 'failed' | 'confirm' | 'ready';

export interface ResumeAvailability<T extends ResumeAvailabilityItem = ResumeAvailabilityItem> {
  status: ResumeAvailabilityStatus;
  eligible: T[];
  processing: T[];
  pendingConfirm: T[];
  failed: T[];
}

export function isEligibleResume(resume: ResumeAvailabilityItem): boolean {
  return resume.processing_status === 'ready' && resume.segmentation_confirmed === true;
}

export function classifyResumeAvailability<T extends ResumeAvailabilityItem>(
  resumes: T[],
): ResumeAvailability<T> {
  const eligible = resumes.filter(isEligibleResume);
  const processing = resumes.filter((resume) => isActiveResumeProcessing(resume.processing_status));
  const failed = resumes.filter((resume) => resume.processing_status === 'failed');
  const pendingConfirm = resumes.filter((resume) => (
    resume.processing_status === 'needs_confirmation'
    || (resume.processing_status === 'ready' && resume.segmentation_confirmed !== true)
  ));

  let status: ResumeAvailabilityStatus = 'none';
  if (eligible.length > 0) status = 'ready';
  else if (processing.length > 0) status = 'processing';
  else if (pendingConfirm.length > 0) status = 'confirm';
  else if (failed.length > 0) status = 'failed';
  else if (resumes.length > 0) status = 'processing';

  return { status, eligible, processing, pendingConfirm, failed };
}

export function pickEligibleResumeId(
  eligible: Array<{ id: number }>,
  preferred?: number | string | null,
): number | null {
  const preferredId = Number(preferred);
  if (Number.isInteger(preferredId) && preferredId > 0 && eligible.some((resume) => resume.id === preferredId)) {
    return preferredId;
  }
  return eligible[0]?.id ?? null;
}
