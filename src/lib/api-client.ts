import { getSupabaseBrowserClient, clearInvalidSession } from '@/lib/supabase-browser';
import { LOCAL_DEV_ACCESS_TOKEN } from '@/lib/dev-auth';
import { applyLocalDevAuthHeaders, readLocalDevAuthEnabled } from '@/lib/dev-auth-client';

// 一次 401 自愈就够了：清完会话后由 AuthGuard 跳登录页，不要每个并发请求都清一遍。
let invalidating = false;

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

  const hadToken = headers.has('Authorization');
  const response = await fetch(input, {
    ...init,
    headers,
    credentials: 'same-origin',
  });

  // 我们以为有会话，服务端却说这个 token 不认（例如切换认证栈后签名密钥变了）。
  // 此时必须清掉本地会话，否则界面会停在“看起来登录了、实际处处 401”的假状态。
  if (response.status === 401 && hadToken && !invalidating) {
    invalidating = true;
    void clearInvalidSession()
      .catch(() => undefined)
      .finally(() => {
        setTimeout(() => {
          invalidating = false;
        }, 5_000);
      });
  }

  return response;
}
