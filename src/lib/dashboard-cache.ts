const DASHBOARD_CACHE_PREFIX = 'liorvix.dashboard.';
const ONBOARDING_CACHE_PREFIX = 'liorvix.onboarding.';
export const RESUME_UPDATED_STORAGE_KEY = 'liorvix.resumeUpdatedAt';
export const RESUME_UPDATED_EVENT = 'liorvix-resume-updated';

export const DASHBOARD_CACHE_TTL_MS = 10 * 60 * 1000;

export function dashboardCacheKey(userId: string, locale: string, resumeId: number | null) {
  return `${DASHBOARD_CACHE_PREFIX}${userId}.${locale}.${resumeId || 'latest'}.v2`;
}

export function readDashboardCache<T>(userId: string, locale: string, resumeId: number | null): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(dashboardCacheKey(userId, locale, resumeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; data?: T };
    if (!parsed.savedAt || !parsed.data || Date.now() - parsed.savedAt > DASHBOARD_CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function writeDashboardCache<T>(userId: string, locale: string, resumeId: number | null, data: T) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      dashboardCacheKey(userId, locale, resumeId),
      JSON.stringify({ savedAt: Date.now(), data }),
    );
  } catch {
    // Cache failures must never block the live dashboard response.
  }
}

function removeSessionKeysByPrefix(prefix: string) {
  if (typeof window === 'undefined') return;
  const keys: string[] = [];
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index);
    if (key && key.startsWith(prefix)) keys.push(key);
  }
  keys.forEach((key) => window.sessionStorage.removeItem(key));
}

export function notifyResumeUpdated() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RESUME_UPDATED_STORAGE_KEY, String(Date.now()));
  } catch {
    // Private browsing can block storage writes.
  }
  window.dispatchEvent(new CustomEvent(RESUME_UPDATED_EVENT));
}

export function clearCockpitClientCaches() {
  if (typeof window === 'undefined') return;
  try {
    removeSessionKeysByPrefix(DASHBOARD_CACHE_PREFIX);
    removeSessionKeysByPrefix(ONBOARDING_CACHE_PREFIX);
  } catch {
    // Cache invalidation is best-effort.
  }
  notifyResumeUpdated();
}
