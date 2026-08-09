import { createClient, SupabaseClient } from '@supabase/supabase-js';

let clientPromise: Promise<SupabaseClient> | null = null;

export interface AuthConfig {
  url: string;
  anonKey: string;
}

async function fetchConfig(): Promise<AuthConfig> {
  const res = await fetch('/api/auth/config');
  if (!res.ok) {
    throw new Error('获取 Supabase 配置失败');
  }
  return res.json();
}

/**
 * 浏览器端 Supabase 客户端（懒加载）。
 * 首次调用时从 /api/auth/config 拉取公开配置并初始化 client，后续复用。
 */
export function getSupabaseBrowserClient(): Promise<SupabaseClient> {
  if (clientPromise) {
    return clientPromise;
  }

  clientPromise = fetchConfig()
    .then(({ url, anonKey }) =>
      createClient(url, anonKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
          storage: typeof window !== 'undefined' ? localStorage : undefined,
        },
      })
    )
    .catch((error) => {
      clientPromise = null;
      throw error;
    });

  return clientPromise;
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
