import {
  LOCAL_DEV_AUTH_HEADER,
  LOCAL_DEV_AUTH_VALUE,
  isLocalDevAuthEnabled,
} from '@/lib/dev-auth';

let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;

export async function readLocalDevAuthEnabled(): Promise<boolean> {
  if (cached !== null) return cached;
  if (inflight) return inflight;
  inflight = fetch('/api/auth/config', { credentials: 'same-origin' })
    .then(async (response) => {
      if (!response.ok) return isLocalDevAuthEnabled();
      const payload = await response.json() as { devAuth?: boolean };
      return payload.devAuth === true;
    })
    .catch(() => isLocalDevAuthEnabled())
    .then((enabled) => {
      cached = enabled;
      inflight = null;
      return enabled;
    });
  return inflight;
}

export function applyLocalDevAuthHeaders(headers: Headers): void {
  headers.set(LOCAL_DEV_AUTH_HEADER, LOCAL_DEV_AUTH_VALUE);
}
