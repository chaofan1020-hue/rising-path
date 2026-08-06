'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;

export async function createBrowserClient(): Promise<SupabaseClient> {
  if (cachedClient) return cachedClient;

  const res = await fetch('/api/supabase-config', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load Supabase config');

  const { url, anonKey } = (await res.json()) as { url: string; anonKey: string };

  cachedClient = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });

  return cachedClient;
}
