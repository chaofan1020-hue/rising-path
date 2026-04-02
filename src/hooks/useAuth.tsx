'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, getCurrentUser, signIn, signUp, signOut, updateProfile, onAuthStateChange } from '@/lib/auth-client';
import { useRouter } from 'next/navigation';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<User>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Check current user on mount
    getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));

    // Subscribe to auth changes
    const { data: { subscription } } = onAuthStateChange((currentUser) => {
      setUser(currentUser);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleSignIn = async (email: string, password: string) => {
    const { session } = await signIn(email, password);
    if (session) {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
    }
  };

  const handleSignUp = async (email: string, password: string, fullName?: string) => {
    await signUp(email, password, fullName);
    // After signup, user needs to verify email (if email confirmation is enabled)
  };

  const handleSignOut = async () => {
    await signOut();
    setUser(null);
    router.push('/login');
  };

  const handleUpdateProfile = async (updates: Partial<User>) => {
    const updated = await updateProfile(updates);
    setUser(prev => prev ? { ...prev, ...updates } : null);
    return updated;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signIn: handleSignIn,
        signUp: handleSignUp,
        signOut: handleSignOut,
        updateProfile: handleUpdateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
