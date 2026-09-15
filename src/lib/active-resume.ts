export const ACTIVE_RESUME_STORAGE_KEY = 'liorvix.activeResumeId';

export function readActiveResumeId(): number | null {
  if (typeof window === 'undefined') return null;
  const value = Number(window.localStorage.getItem(ACTIVE_RESUME_STORAGE_KEY));
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function writeActiveResumeId(resumeId: number | null): void {
  if (typeof window === 'undefined') return;
  if (resumeId && Number.isInteger(resumeId) && resumeId > 0) {
    window.localStorage.setItem(ACTIVE_RESUME_STORAGE_KEY, String(resumeId));
  } else {
    window.localStorage.removeItem(ACTIVE_RESUME_STORAGE_KEY);
  }
  window.dispatchEvent(new CustomEvent('liorvix-active-resume-change', { detail: resumeId }));
}
