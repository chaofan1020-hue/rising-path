import { createClient, SupabaseClient } from '@supabase/supabase-js';

let clientPromise: Promise<SupabaseClient> | null = null;
const AUTH_CONFIG_CACHE_KEY = 'liorvix.auth-config.v1';

export interface AuthConfig {
  url: string;
  anonKey: string;
}

async function fetchConfig(): Promise<AuthConfig> {
  if (typeof window !== 'undefined') {
    try {
      const cached = window.sessionStorage.getItem(AUTH_CONFIG_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as AuthConfig;
        if (parsed.url && parsed.anonKey) return parsed;
      }
    } catch {
      window.sessionStorage.removeItem(AUTH_CONFIG_CACHE_KEY);
    }
  }

  const res = await fetch('/api/auth/config');
  if (!res.ok) {
    throw new Error('获取 Supabase 配置失败');
  }
  const config = await res.json() as AuthConfig;
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(AUTH_CONFIG_CACHE_KEY, JSON.stringify(config));
    } catch {
      // Private browsing can disallow storage; the client still works normally.
    }
  }
  return config;
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
    .then(({ url, anonKey }) =>
      createClient(url, anonKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl,
          storage: typeof window !== 'undefined' ? localStorage : undefined,
        },
      })
    )
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
