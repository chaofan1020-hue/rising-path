import { createClient, SupabaseClient } from '@supabase/supabase-js';

let clientPromise: Promise<SupabaseClient> | null = null;
// v2 forces a re-fetch of the public auth config on the next page load, which is
// what makes the Cloud -> self-hosted switch visible to browsers that cached the
// old URL / anonymous key for up to 5 minutes.
const AUTH_CONFIG_CACHE_KEY = 'liorvix.auth-config.v2';
// Cache shape is `{ config, savedAt }`. A bare cached config (legacy shape) is
// deliberately discarded on sight: that is exactly the entry written before the
// cutover, and trusting it would keep a stale tab pointed at the old project for
// the rest of the tab session. The TTL then bounds how long any stale entry can
// survive a rollback (rollback points back at the old URL).
const AUTH_CONFIG_CACHE_TTL_MS = 60_000;
// supabase-js derives its default storage key from the auth host
// (`sb-${hostname.split('.')[0]}-auth-token`), so moving from
// `weqvdtdjdzmqflhwobec.supabase.co` to `supabase.liorvix.com` would orphan every
// stored session even though the refresh tokens were migrated. Pin a
// host-independent key and import the legacy session once (see
// `restoreLegacySession`), so cutover keeps users signed in and a future URL
// change cannot log everyone out again.
const SESSION_STORAGE_KEY = 'liorvix.auth.session.v1';
const LAST_AUTH_HOST_KEY = 'liorvix.auth.host.v1';
// 记录“当前浏览器会话属于哪个认证栈”。切换认证栈（Cloud ↔ 自托管）时签名密钥变了，
// 旧 token 在新栈永远校验不过，而 supabase-js 又不会因为一次 refresh 失败就丢掉会话，
// 结局就是“界面像是登录了、每个接口都 401”。所以栈一换就整块清掉旧会话，让用户干净地重登一次。
const AUTH_STACK_KEY = 'liorvix.auth.stack.v1';
const LEGACY_SESSION_KEY = /^sb-.+-auth-token$/;
/** Upper bound for the one-shot post-migration token exchange. */
const SESSION_REFRESH_TIMEOUT_MS = 8_000;

export interface AuthConfig {
  url: string;
  anonKey: string;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { key(index: number): string | null; readonly length: number };

function parseSession(raw: string | null): { refresh_token?: unknown; expires_at?: unknown } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { refresh_token?: unknown; expires_at?: unknown };
    return parsed && typeof parsed.refresh_token === 'string' && parsed.refresh_token ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Picks the freshest legacy supabase-js session from a storage snapshot.
 * Exported (and storage-agnostic) so the cutover behaviour can be unit tested
 * without a browser: `keys` are the storage keys, `read` returns their value.
 */
export function pickLegacySession(
  keys: string[],
  read: (key: string) => string | null,
  currentKey: string,
): string | null {
  if (keys.includes(currentKey) && parseSession(read(currentKey))) return null;
  let bestKey: string | null = null;
  let bestExpiry = Number.NEGATIVE_INFINITY;
  let fallbackKey: string | null = null;
  for (const key of keys) {
    if (key === currentKey || !LEGACY_SESSION_KEY.test(key)) continue;
    const session = parseSession(read(key));
    if (!session) continue;
    if (fallbackKey === null) fallbackKey = key;
    const expiry = typeof session.expires_at === 'number' && Number.isFinite(session.expires_at)
      ? session.expires_at
      : Number.NEGATIVE_INFINITY;
    if (expiry > bestExpiry) {
      bestExpiry = expiry;
      bestKey = key;
    }
  }
  return bestKey ?? fallbackKey;
}

function storageAvailable(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    const storage = window.localStorage;
    // Safari private mode throws on setItem; probe before touching legacy keys.
    const probe = '__liorvix_storage_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/** Copies the legacy supabase-js session into the pinned key. Returns true when a refresh is needed. */
export function restoreLegacySession(storage: StorageLike | null = storageAvailable()): boolean {
  if (!storage) return false;
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) keys.push(key);
    }
    const legacyKey = pickLegacySession(keys, (key) => storage.getItem(key), SESSION_STORAGE_KEY);
    if (!legacyKey) return false;
    const raw = storage.getItem(legacyKey);
    if (!raw) return false;
    storage.setItem(SESSION_STORAGE_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

function authHost(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/**
 * Reads the public auth config, memoised for at most one minute and only in the
 * `{ config, savedAt }` shape. Exported so the cutover/rollback cache behaviour is
 * unit tested (see scripts/test-auth-session-migration.ts).
 */
export async function fetchConfig(): Promise<AuthConfig> {
  const storage = typeof window !== 'undefined' ? window.sessionStorage : null;
  if (storage) {
    try {
      const cached = storage.getItem(AUTH_CONFIG_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as { config?: AuthConfig; savedAt?: number };
        const fresh = parsed.config
          && parsed.config.url
          && parsed.config.anonKey
          && typeof parsed.savedAt === 'number'
          && Date.now() - parsed.savedAt < AUTH_CONFIG_CACHE_TTL_MS;
        if (fresh) return parsed.config as AuthConfig;
        // Legacy bare config, or expired entry: drop it and ask the server again.
        storage.removeItem(AUTH_CONFIG_CACHE_KEY);
      }
    } catch {
      storage.removeItem(AUTH_CONFIG_CACHE_KEY);
    }
  }

  // 切流/回滚会换掉 url + anonKey，这个响应一旦被浏览器 HTTP 缓存住，
  // 旧标签页就会继续对着旧栈登录（现象：GitHub 走旧 App、登录后处处 401）。
  const res = await fetch('/api/auth/config', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('获取 Supabase 配置失败');
  }
  const config = await res.json() as AuthConfig;
  if (storage) {
    try {
      storage.setItem(AUTH_CONFIG_CACHE_KEY, JSON.stringify({ config, savedAt: Date.now() }));
    } catch {
      // Private browsing can disallow storage; the client still works normally.
    }
  }
  return config;
}

/**
 * 清掉所有可能承载旧认证栈会话的存储项：固定会话键、supabase-js 的 legacy
 * `sb-<host>-auth-token*` 键、PKCE code verifier，以及会话级的配置缓存。
 * 换栈之后这些数据全部不可用，留着只会制造“已登录但处处 401”的假象。
 */
function purgeStoredAuth(storage: StorageLike | null, sessionStorageLike: StorageLike | null) {
  const clear = (target: StorageLike | null) => {
    if (!target) return;
    try {
      const stale: string[] = [];
      for (let index = 0; index < target.length; index += 1) {
        const key = target.key(index);
        if (!key) continue;
        if (
          key === SESSION_STORAGE_KEY ||
          LEGACY_SESSION_KEY.test(key) ||
          /^sb-.+-auth-token(?:-code-verifier|-user)?$/.test(key)
        ) {
          stale.push(key);
        }
      }
      for (const key of stale) target.removeItem(key);
    } catch {
      // 隐私模式可能不允许读写 storage，忽略即可
    }
  };
  clear(storage);
  clear(sessionStorageLike);
}

/**
 * Creates the client and, when the auth host changed (migration or rollback) or a
 * legacy session was imported, exchanges the stored refresh token for a token
 * signed by the current auth server. Migrated `auth.refresh_tokens` rows are what
 * make that exchange possible, so the user never sees a signed-out state.
 */
async function prepareClient(config: AuthConfig): Promise<SupabaseClient> {
  const host = authHost(config.url);
  let stackChanged = false;
  if (typeof window !== 'undefined') {
    try {
      const previousStack = window.localStorage.getItem(AUTH_STACK_KEY);
      const previousHost = window.localStorage.getItem(LAST_AUTH_HOST_KEY);
      // 1) 首次部署新逻辑（没有标记）说明浏览器里可能躺着上一个认证栈的会话；
      // 2) 标记与当前 host 不一致，说明发生了切流/回滚。两种情况都必须清会话。
      stackChanged = previousStack === null ? previousHost !== null : previousStack !== host;
      if (stackChanged) {
        purgeStoredAuth(window.localStorage, window.sessionStorage);
      }
      window.localStorage.setItem(AUTH_STACK_KEY, host);
      window.localStorage.setItem(LAST_AUTH_HOST_KEY, host);
    } catch {
      stackChanged = false;
    }
  }

  const restoredLegacySession = stackChanged ? false : restoreLegacySession();

  const client = createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storageKey: SESSION_STORAGE_KEY,
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    },
  });

  if (restoredLegacySession) {
    // Never let a slow auth server block first paint: the refresh is an
    // optimisation that upgrades the stored token, and supabase-js retries it on
    // the next API call anyway.
    await Promise.race([
      client.auth.refreshSession().then(({ error }) => {
        if (error) console.warn('[auth] session refresh after auth-host change failed', error.message);
      }).catch((error) => {
        console.warn('[auth] session refresh after auth-host change threw', error);
      }),
      new Promise<void>((resolve) => setTimeout(resolve, SESSION_REFRESH_TIMEOUT_MS)),
    ]);
  }

  return client;
}

/**
 * 浏览器端 Supabase 客户端（懒加载）。
 * 首次调用时从 /api/auth/config 拉取公开配置并初始化 client，后续复用。
 */
export function getSupabaseBrowserClient(options?: { detectSessionInUrl?: boolean }): Promise<SupabaseClient> {
  const detectSessionInUrl = options?.detectSessionInUrl ?? true;
  if (detectSessionInUrl && clientPromise) {
    return clientPromise;
  }

  const nextClient = fetchConfig()
    .then((config) => prepareClient(config))
    .catch((error) => {
      if (detectSessionInUrl) clientPromise = null;
      throw error;
    });

  if (detectSessionInUrl) clientPromise = nextClient;

  return nextClient;
}

export async function getCurrentSession() {
  const client = await getSupabaseBrowserClient();
  const {
    data: { session },
    error,
  } = await client.auth.getSession();
  if (error) {
    throw error;
  }
  return session;
}

export async function signOut() {
  const client = await getSupabaseBrowserClient();
  return client.auth.signOut();
}

/**
 * 服务端认为这个 token 无效（401）时调用：把本地会话整块丢掉，并让 supabase-js
 * 发出 SIGNED_OUT，AuthGuard 收到后会把用户引导到登录页。
 *
 * 这修的是“界面以为自己登录了、每个接口都 401”的假登录状态：以前只会静默 401，
 * 用户看到的是满屏“未登录”却没有跳转。自愈之后一次跳转就能恢复。
 */
export async function clearInvalidSession(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  let hadSession = false;
  try {
    hadSession = Boolean(window.localStorage.getItem(SESSION_STORAGE_KEY))
      || Object.keys(window.localStorage).some((key) => /^sb-.+-auth-token/.test(key));
  } catch {
    // 隐私模式下读不到 storage，按“没有会话”处理
  }
  purgeStoredAuth(
    typeof window !== 'undefined' ? window.localStorage : null,
    typeof window !== 'undefined' ? window.sessionStorage : null,
  );
  // 通知订阅者（AuthGuard），并把内存里的 client 复位，下次调用会重新初始化。
  try {
    if (clientPromise) {
      const client = await clientPromise.catch(() => null);
      await client?.auth.signOut({ scope: 'local' }).catch(() => undefined);
    }
  } finally {
    clientPromise = null;
  }
  return hadSession;
}