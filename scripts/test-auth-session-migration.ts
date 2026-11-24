import assert from 'node:assert/strict';
import { fetchConfig, pickLegacySession, restoreLegacySession } from '@/lib/supabase-browser';

// Minimal in-memory stand-in for `window.localStorage`. The migration helpers are
// storage-agnostic precisely so this cutover path can be verified without a
// browser, including the case where an old supabase-js session has to be carried
// across an auth-host change.
class MemoryStorage {
  private data = new Map<string, string>();

  get length(): number { return this.data.size; }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key) ?? null : null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

const CURRENT_KEY = 'liorvix.auth.session.v1';
const session = (expiresAt: number, token = 'refresh-token') => JSON.stringify({
  access_token: `access-${expiresAt}`,
  refresh_token: token,
  expires_at: expiresAt,
  token_type: 'bearer',
});

// 1. Nothing to migrate.
{
  const storage = new MemoryStorage();
  assert.equal(pickLegacySession([], (key) => storage.getItem(key), CURRENT_KEY), null);
  assert.equal(restoreLegacySession(storage), false);
}

// 2. Single legacy Cloud session is imported into the pinned key.
{
  const storage = new MemoryStorage();
  const legacyKey = 'sb-weqvdtdjdzmqflhwobec-auth-token';
  storage.setItem(legacyKey, session(1_800_000_000));
  assert.equal(pickLegacySession(
    ['foo', legacyKey, 'sb-x-auth-token-code-verifier'],
    (key) => storage.getItem(key),
    CURRENT_KEY,
  ), legacyKey);
  assert.equal(restoreLegacySession(storage), true);
  assert.equal(storage.getItem(CURRENT_KEY), storage.getItem(legacyKey));
}

// 3. Two legacy sessions: the one that expires last wins.
{
  const storage = new MemoryStorage();
  storage.setItem('sb-oldauth-auth-token', session(1_700_000_000, 'older'));
  storage.setItem('sb-newauth-auth-token', session(1_900_000_000, 'newer'));
  assert.equal(restoreLegacySession(storage), true);
  const stored = JSON.parse(storage.getItem(CURRENT_KEY) || '{}');
  assert.equal(stored.refresh_token, 'newer');
}

// 4. Corrupted payloads and code verifiers are ignored.
{
  const storage = new MemoryStorage();
  storage.setItem('sb-broken-auth-token', '{not-json');
  storage.setItem('sb-norefresh-auth-token', JSON.stringify({ access_token: 'a' }));
  storage.setItem('sb-verifier-auth-token-code-verifier', 'verifier');
  assert.equal(restoreLegacySession(storage), false);
  assert.equal(storage.getItem(CURRENT_KEY), null);
}

// 5. An existing pinned session is never overwritten by a stale legacy one.
{
  const storage = new MemoryStorage();
  storage.setItem(CURRENT_KEY, session(1_950_000_000, 'current'));
  storage.setItem('sb-weqvdtdjdzmqflhwobec-auth-token', session(1_600_000_000, 'legacy'));
  assert.equal(pickLegacySession(
    [CURRENT_KEY, 'sb-weqvdtdjdzmqflhwobec-auth-token'],
    (key) => storage.getItem(key),
    CURRENT_KEY,
  ), null);
  assert.equal(restoreLegacySession(storage), false);
  assert.equal(JSON.parse(storage.getItem(CURRENT_KEY) || '{}').refresh_token, 'current');
}

// 6. Sessions without an expiry still migrate (order falls back to insertion order).
{
  const storage = new MemoryStorage();
  storage.setItem('sb-ref-auth-token', JSON.stringify({ access_token: 'a', refresh_token: 'no-expiry' }));
  assert.equal(restoreLegacySession(storage), true);
  assert.equal(JSON.parse(storage.getItem(CURRENT_KEY) || '{}').refresh_token, 'no-expiry');
}

// 7. Storage that throws (Safari private mode / disabled cookies) is tolerated.
{
  const broken = {
    get length(): number { throw new Error('denied'); },
    key(): string | null { throw new Error('denied'); },
    getItem(): string | null { throw new Error('denied'); },
    setItem(): void { throw new Error('denied'); },
    removeItem(): void { throw new Error('denied'); },
  };
  assert.equal(restoreLegacySession(broken), false);
}

// 8-10. Public auth config cache: a bare (pre-cutover) entry must be refetched,
// a fresh entry is reused, and an expired entry is refetched. This is what makes a
// URL switch visible without waiting for users to clear storage.
// Wrapped in an async function because this script is transpiled to CJS.
async function checkAuthConfigCache(): Promise<void> {
  const configKey = 'liorvix.auth-config.v2';
  const globalScope = globalThis as unknown as { window?: unknown; fetch?: unknown };
  const originalWindow = globalScope.window;
  const originalFetch = globalScope.fetch;
  const fresh = { url: 'https://supabase.liorvix.com', anonKey: 'new-anon' };
  const stubFetch = (calls: { count: number }) => async () => {
    calls.count += 1;
    return { ok: true, json: async () => fresh } as unknown as Response;
  };

  try {
    // 8. Legacy bare cache: discarded and replaced with the fetched config.
    {
      const sessionStorage = new MemoryStorage();
      sessionStorage.setItem(configKey, JSON.stringify({ url: 'https://old.example', anonKey: 'old-anon' }));
      globalScope.window = { sessionStorage };
      const calls = { count: 0 };
      globalScope.fetch = stubFetch(calls);
      const config = await fetchConfig();
      assert.equal(calls.count, 1);
      assert.equal(config.url, fresh.url);
      const stored = JSON.parse(sessionStorage.getItem(configKey) || '{}');
      assert.equal(stored.config.url, fresh.url);
      assert.equal(typeof stored.savedAt, 'number');
    }

    // 9. Fresh cache: no network call at all.
    {
      const sessionStorage = new MemoryStorage();
      sessionStorage.setItem(configKey, JSON.stringify({ config: fresh, savedAt: Date.now() }));
      globalScope.window = { sessionStorage };
      const calls = { count: 0 };
      globalScope.fetch = stubFetch(calls);
      const config = await fetchConfig();
      assert.equal(calls.count, 0);
      assert.equal(config.anonKey, fresh.anonKey);
    }

    // 10. Expired cache: refetched (bounds staleness after a rollback).
    {
      const sessionStorage = new MemoryStorage();
      sessionStorage.setItem(configKey, JSON.stringify({ config: { url: 'https://stale.example', anonKey: 'x' }, savedAt: Date.now() - 120_000 }));
      globalScope.window = { sessionStorage };
      const calls = { count: 0 };
      globalScope.fetch = stubFetch(calls);
      const config = await fetchConfig();
      assert.equal(calls.count, 1);
      assert.equal(config.url, fresh.url);
    }
  } finally {
    globalScope.window = originalWindow;
    globalScope.fetch = originalFetch;
  }
}

checkAuthConfigCache()
  .then(() => {
    console.log('auth session migration: 10 scenarios passed');
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });