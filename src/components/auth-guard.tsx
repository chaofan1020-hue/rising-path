'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { Loader2 as AnimatedLoader } from '@/components/ui/loader-2';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { isEmailVerified } from '@/lib/auth-shared';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);
let verifiedUserCache: User | null = null;

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    return { user: null, isAuthenticated: false, logout: async () => {} };
  }
  return context;
}

export function AuthGuard({
  children,
  showAccountBar = false,
}: {
  children: ReactNode;
  showAccountBar?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(() => verifiedUserCache === null);
  const [user, setUser] = useState<User | null>(() => verifiedUserCache);
  const [authorized, setAuthorized] = useState(() => verifiedUserCache !== null);

  useEffect(() => {
    let mounted = true;
    let authListener: { subscription: { unsubscribe: () => void } } | null = null;

    const applySession = (nextUser: User | null) => {
      if (!mounted) return;
      if (!nextUser) {
        verifiedUserCache = null;
        setUser(null);
        setAuthorized(false);
        setLoading(false);
        router.replace('/login');
        return;
      }
      if (!isEmailVerified(nextUser)) {
        verifiedUserCache = null;
        setUser(nextUser);
        setAuthorized(false);
        setLoading(false);
        router.replace('/login?verify=1');
        return;
      }

      verifiedUserCache = nextUser;
      setUser(nextUser);
      setAuthorized(true);
      setLoading(false);
    };

    const init = async () => {
      try {
        const client = await getSupabaseBrowserClient();
        const {
          data: { session },
        } = await client.auth.getSession();

        applySession(session?.user ?? null);

        const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
          applySession(nextSession?.user ?? null);
        });
        authListener = listener;
      } catch (error) {
        console.error('[Auth] Failed to initialize session:', error);
        if (mounted) {
          verifiedUserCache = null;
          setLoading(false);
          router.replace('/login');
        }
      }
    };

    void init();
    return () => {
      mounted = false;
      authListener?.subscription.unsubscribe();
    };
  }, [router]);

  const logout = async () => {
    const client = await getSupabaseBrowserClient();
    await client.auth.signOut();
    verifiedUserCache = null;
    setUser(null);
    setAuthorized(false);
    router.replace('/login');
  };

  const contextValue: AuthContextType = {
    user,
    isAuthenticated: authorized,
    logout,
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-black">
        <AnimatedLoader />
      </div>
    );
  }

  if (!authorized || !user) return null;

  return (
    <AuthContext.Provider value={contextValue}>
      {showAccountBar && (
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
      )}
      <div className="app-page-enter">{children}</div>
    </AuthContext.Provider>
  );
}
