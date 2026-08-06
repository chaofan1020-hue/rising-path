'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useSupabase } from '@/components/supabase-config-inject';
import type { Session, User, SupabaseClient } from '@supabase/supabase-js';

const publicPaths = new Set(['/', '/access-code', '/register', '/login']);

interface AccessCode {
  id: number;
  code: string;
  name: string | null;
}

interface AccessGuardContextValue {
  user: User | null;
  accessCode: AccessCode | null;
  accessCodeId: number | null;
  isLoading: boolean;
  logout: () => Promise<void>;
  supabase: SupabaseClient | null;
  session: Session | null;
}

const AccessGuardContext = createContext<AccessGuardContextValue | null>(null);

export function useAccessGuard() {
  const ctx = useContext(AccessGuardContext);
  if (!ctx) {
    return {
      user: null,
      accessCode: null,
      accessCodeId: null,
      isLoading: false,
      logout: () => Promise.resolve(),
      supabase: null,
      session: null,
    };
  }
  return ctx;
}

export function useAccessCode() {
  const ctx = useContext(AccessGuardContext);
  if (!ctx) {
    return {
      accessCodeId: null,
      accessCodeName: null,
      isLoading: false,
    };
  }
  return {
    accessCodeId: ctx.accessCodeId,
    accessCodeName: ctx.user?.email ?? ctx.accessCode?.name ?? null,
    isLoading: ctx.isLoading,
  };
}

export function AccessGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useSupabase();

  const [session, setSession] = useState<Session | null>(null);
  const [accessCode, setAccessCode] = useState<AccessCode | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isPublic = useMemo(
    () => (pathname ? publicPaths.has(pathname) : false),
    [pathname]
  );

  const user = useMemo(() => session?.user ?? null, [session]);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;

    supabase.auth
      .getSession()
      .then(({ data: { session: initialSession } }) => {
        if (!mounted) return;
        setSession(initialSession ?? null);

        if (initialSession?.access_token) {
          fetch('/api/auth/session', {
            headers: { 'x-session': initialSession.access_token },
          })
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
              if (mounted) setAccessCode(data?.accessCode ?? null);
            })
            .catch(() => null)
            .finally(() => {
              if (mounted) setIsLoading(false);
            });
        } else {
          setIsLoading(false);
        }

        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange(
          (_event: string, newSession: Session | null) => {
            if (!mounted) return;
            setSession(newSession ?? null);
            if (newSession?.access_token) {
              fetch('/api/auth/session', {
                headers: { 'x-session': newSession.access_token },
              })
                .then((res) => (res.ok ? res.json() : null))
                .then((data) => setAccessCode(data?.accessCode ?? null))
                .catch(() => null);
            } else {
              setAccessCode(null);
            }
          }
        );

        return () => subscription.unsubscribe();
      })
      .catch(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [supabase]);

  useEffect(() => {
    if (isLoading || isPublic) return;
    if (!session && pathname) {
      router.replace('/register');
    }
  }, [isLoading, isPublic, session, pathname, router]);

  const logout = useCallback(async () => {
    await supabase?.auth.signOut();
    setSession(null);
    setAccessCode(null);
    router.push('/login');
  }, [supabase, router]);

  const value = useMemo(
    () => ({
      user,
      accessCode,
      accessCodeId: accessCode?.id ?? null,
      isLoading,
      logout,
      supabase,
      session,
    }),
    [user, accessCode, isLoading, logout, supabase, session]
  );

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!session && !isPublic) {
    return null;
  }

  return (
    <AccessGuardContext.Provider value={value}>
      {children}
    </AccessGuardContext.Provider>
  );
}
