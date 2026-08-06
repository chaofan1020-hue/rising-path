'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { User } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { Loader2 as AnimatedLoader } from '@/components/ui/loader-2';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

interface AccessCodeContextType {
  accessCode: string | null;
  accessCodeId: string | null;
  user: User | null;
  isAuthenticated: boolean;
  logout: () => void;
}

const AccessCodeContext = createContext<AccessCodeContextType | null>(null);

export function useAccessCode() {
  const context = useContext(AccessCodeContext);
  if (!context) {
    return {
      accessCode: null,
      accessCodeId: null,
      user: null,
      isAuthenticated: false,
      logout: () => {},
    };
  }
  return context;
}

export function AccessGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    let mounted = true;
    let authListener: { subscription: { unsubscribe: () => void } } | null = null;

    const init = async () => {
      const client = await getSupabaseBrowserClient();
      const {
        data: { session },
      } = await client.auth.getSession();

      if (!mounted) return;

      if (session?.user) {
        setUser(session.user);
        setAuthorized(true);
      } else {
        router.replace('/login');
      }
      setLoading(false);

      const { data: listener } = client.auth.onAuthStateChange(
        (_event, newSession) => {
          if (!mounted) return;
          if (newSession?.user) {
            setUser(newSession.user);
            setAuthorized(true);
          } else {
            setUser(null);
            setAuthorized(false);
            router.replace('/login');
          }
        }
      );
      authListener = listener;
    };

    init();

    return () => {
      mounted = false;
      authListener?.subscription.unsubscribe();
    };
  }, [router]);

  const logout = async () => {
    const client = await getSupabaseBrowserClient();
    await client.auth.signOut();
    localStorage.removeItem('access_code');
    localStorage.removeItem('access_code_id');
    setUser(null);
    setAuthorized(false);
    router.replace('/login');
  };

  const contextValue: AccessCodeContextType = {
    accessCode: null,
    accessCodeId: null,
    user,
    isAuthenticated: authorized,
    logout,
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <AnimatedLoader />
      </div>
    );
  }

  if (!authorized || !user) {
    return null;
  }

  return (
    <AccessCodeContext.Provider value={contextValue}>
      <div className="bg-primary/5 border-b py-1.5 px-4">
        <div className="container mx-auto flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span>当前账号:</span>
            <code className="bg-background px-2 py-0.5 rounded font-mono text-xs">
              {user.email}
            </code>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            className="h-7 text-xs"
          >
            退出登录
          </Button>
        </div>
      </div>
      {children}
    </AccessCodeContext.Provider>
  );
}
