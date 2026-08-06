'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createBrowserClient } from '@/lib/supabase-browser';
import type { SupabaseClient } from '@supabase/supabase-js';

interface SupabaseConfigContextValue {
  supabase: SupabaseClient | null;
  isLoading: boolean;
  ready: boolean;
}

const SupabaseConfigContext = createContext<SupabaseConfigContextValue>({
  supabase: null,
  isLoading: true,
  ready: false,
});

export function useSupabase() {
  return useContext(SupabaseConfigContext).supabase;
}

export function useSupabaseConfig() {
  return useContext(SupabaseConfigContext);
}

export function SupabaseConfigProvider({ children }: { children: ReactNode }) {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    createBrowserClient()
      .then((client) => {
        if (mounted) setSupabase(client);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <SupabaseConfigContext.Provider value={{ supabase, isLoading, ready: !isLoading && supabase !== null }}>
      {children}
    </SupabaseConfigContext.Provider>
  );
}
