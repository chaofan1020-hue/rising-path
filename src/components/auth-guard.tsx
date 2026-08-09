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

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    return { user: null, isAuthenticated: false, logout: async () => {} };
  }
  return context;
}

export function AuthGuard({
  children,
  showAccountBar = true,
}: {
  children: ReactNode;
  showAccountBar?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    let mounted = true;
    let authListener: { subscription: { unsubscribe: () => void } } | null = null;

    const init = async () => {
      try {
        const client = await getSupabaseBrowserClient();
        const {
          data: { session },
        } = await client.auth.getSession();

        if (!mounted) return;
        const nextUser = session?.user ?? null;
        if (!nextUser) {
          router.replace('/login');
        } else if (!isEmailVerified(nextUser)) {
          router.replace('/login?verify=1');
        } else {
          setUser(nextUser);
          setAuthorized(true);
        }
        setLoading(false);

        const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
          if (!mounted) return;
          const nextSessionUser = nextSession?.user ?? null;
          if (!nextSessionUser) {
            setUser(null);
            setAuthorized(false);
            router.replace('/login');
          } else if (!isEmailVerified(nextSessionUser)) {
            setUser(nextSessionUser);
            setAuthorized(false);
            router.replace('/login?verify=1');
          } else {
            setUser(nextSessionUser);
            setAuthorized(true);
          }
        });
        authListener = listener;
      } catch (error) {
        console.error('[Auth] Failed to initialize session:', error);
        if (mounted) {
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
      {children}
    </AuthContext.Provider>
  );
}
