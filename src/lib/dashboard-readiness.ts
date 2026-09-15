import {
  isActiveResumeProcessing,
  type ResumeProcessingStatus,
} from '@/lib/resume-types';

export interface DashboardReadinessInput {
  hasResume: boolean;
  processingStatus?: ResumeProcessingStatus | string | null;
  segmentationConfirmed?: boolean | null;
  hasRegion: boolean;
  hasRoles: boolean;
  identityMissing: boolean;
}

export interface DashboardReadiness {
  processing: boolean;
  failed: boolean;
  planReady: boolean;
  profileReady: boolean;
  missingSteps: string[];
}

export function computeDashboardReadiness(input: DashboardReadinessInput): DashboardReadiness {
  const processing = isActiveResumeProcessing(input.processingStatus);
  const failed = input.processingStatus === 'failed';
  const confirmed = input.segmentationConfirmed === true;
  const planReady = Boolean(input.hasResume && confirmed && input.hasRegion && !processing && !failed);
  const profileReady = Boolean(planReady && input.hasRoles && !input.identityMissing);
  const missingSteps: string[] = [];

  if (!input.hasResume) missingSteps.push('resume');
  else if (processing) missingSteps.push('processing');
  else if (failed) missingSteps.push('failed');
  else if (!confirmed) missingSteps.push('confirm');
  if (!input.hasRegion) missingSteps.push('region');
  if (!input.hasRoles) missingSteps.push('role');
  if (input.identityMissing) missingSteps.push('identity');

  return { processing, failed, planReady, profileReady, missingSteps };
}

export const RESUME_PROCESSING_STALE_MS = 5 * 60 * 1000;
export const MAX_RESUME_PROCESSING_ATTEMPTS = 3;

export function nextStaleResumeProcessingAction(attempts: number): 'requeue' | 'fail' {
  return attempts >= MAX_RESUME_PROCESSING_ATTEMPTS ? 'fail' : 'requeue';
}
