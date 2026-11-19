import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { LOCAL_DEV_ACCESS_TOKEN } from '@/lib/dev-auth';
import { applyLocalDevAuthHeaders, readLocalDevAuthEnabled } from '@/lib/dev-auth-client';

/** Attach the current Supabase access token to application API requests. */
export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);

  if (await readLocalDevAuthEnabled()) {
    applyLocalDevAuthHeaders(headers);
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${LOCAL_DEV_ACCESS_TOKEN}`);
    }
  } else {
    try {
      const client = await getSupabaseBrowserClient();
      const {
        data: { session },
      } = await client.auth.getSession();
      if (session?.access_token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${session.access_token}`);
      }
    } catch {
      // Let the API return its normal 401 response when no session is available.
    }
  }

  return fetch(input, {
    ...init,
    headers,
    credentials: 'same-origin',
  });
}
