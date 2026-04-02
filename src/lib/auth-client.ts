import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Singleton instance
let supabaseInstance: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  // Get credentials from environment variables
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.COZE_SUPABASE_URL || '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.COZE_SUPABASE_ANON_KEY || '';

  if (!url || !anonKey) {
    console.warn('Supabase credentials not found. Auth features may not work.');
    // Return a dummy client to prevent crashes
    return createClient('https://placeholder.supabase.co', 'placeholder-key');
  }

  supabaseInstance = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });

  return supabaseInstance;
}

export type User = {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
  university?: string;
  major?: string;
  graduation_year?: number;
};

export async function signUp(email: string, password: string, fullName?: string) {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
    },
  });

  if (error) throw error;
  return data;
}

export async function signIn(email: string, password: string) {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

export async function signOut() {
  const client = getSupabaseClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser(): Promise<User | null> {
  const client = getSupabaseClient();
  const { data: { user } } = await client.auth.getUser();
  
  if (!user) return null;

  // Get profile data
  const { data: profile } = await client
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return {
    id: user.id,
    email: user.email || '',
    full_name: profile?.full_name || user.user_metadata?.full_name,
    avatar_url: profile?.avatar_url,
    university: profile?.university,
    major: profile?.major,
    graduation_year: profile?.graduation_year,
  };
}

export async function updateProfile(updates: Partial<User>) {
  const client = getSupabaseClient();
  const { data: { user } } = await client.auth.getUser();
  
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await client
    .from('profiles')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export function onAuthStateChange(callback: (user: User | null) => void) {
  const client = getSupabaseClient();
  return client.auth.onAuthStateChange(async (event) => {
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      const user = await getCurrentUser();
      callback(user);
    } else if (event === 'SIGNED_OUT') {
      callback(null);
    }
  });
}

// Export client for direct access
export { getSupabaseClient };
