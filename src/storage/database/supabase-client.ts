import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config as loadDotenv } from 'dotenv';

let envLoaded = false;

interface SupabaseCredentials {
  url: string;
  anonKey: string;
}

function loadEnv(): void {
  if (envLoaded) {
    return;
  }

  loadDotenv({ path: '.env.local' });

  envLoaded = true;
}

function getSupabaseCredentials(): SupabaseCredentials {
  loadEnv();

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error('SUPABASE_URL is not set');
  }
  if (!anonKey) {
    throw new Error('SUPABASE_ANON_KEY is not set');
  }

  return { url, anonKey };
}

function getSupabaseServiceRoleKey(): string | undefined {
  loadEnv();
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function getSupabaseClient(token?: string): SupabaseClient {
  const { url, anonKey } = getSupabaseCredentials();

  let key: string;
  if (token) {
    key = anonKey;
  } else {
    const serviceRoleKey = getSupabaseServiceRoleKey();
    key = serviceRoleKey ?? anonKey;
  }

  if (token) {
    return createClient(url, key, {
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
      db: {
        timeout: 60000,
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return createClient(url, key, {
    db: {
      timeout: 60000,
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Public-key client for unauthenticated Auth operations.
 * Never use the default getSupabaseClient() here: it may use the service role
 * key on the server and would bypass RLS.
 */
function getSupabaseAnonClient(): SupabaseClient {
  const { url, anonKey } = getSupabaseCredentials();
  return createClient(url, anonKey, {
    db: {
      timeout: 60000,
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export {
  loadEnv,
  getSupabaseCredentials,
  getSupabaseServiceRoleKey,
  getSupabaseClient,
  getSupabaseAnonClient,
};
