'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import LoginSignup, { type RegisterData } from '@/components/ui/login-signup';
import SubscriptionCelebration from '@/components/SubscriptionCelebration';
import { validatePassword } from '@/lib/auth-shared';

type AuthMode = 'login' | 'signup' | 'otp' | 'reset' | 'password';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);

  useEffect(() => {
    let mounted = true;
    getSupabaseBrowserClient().then(async (supabase) => {
      const { data } = await supabase.auth.getSession();
      if (mounted && data.session) {
        router.replace('/home');
      }
    });
    return () => {
      mounted = false;
    };
  }, [router]);

  const handleLogin = async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const result = (await response.json()) as {
        error?: string;
        session?: { access_token: string; refresh_token: string };
      };
      if (!response.ok || !result.session) {
        throw new Error(result.error || 'Sign in failed');
      }
      const supabase = await getSupabaseBrowserClient();
      const { error: sessionError } = await supabase.auth.setSession(result.session);
      if (sessionError) throw sessionError;
      router.replace('/home');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (data: RegisterData) => {
    const passwordError = validatePassword(data.password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (data.confirmPassword !== data.password) {
      setError('Passwords do not match');
      return;
    }
    if (!data.terms) {
      setError('Please accept the terms and conditions');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: data.email,
          password: data.password,
          username: data.username,
          captchaToken: data.captchaToken,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Sign up failed');
      setRegistered(true);
      setMessage('Please check your email to verify your account before signing in.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async (email: string) => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/auth/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Failed to send code');
      setMessage('Code sent. Check your email.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (email: string, otp: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token: otp }),
      });
      const result = (await response.json()) as {
        error?: string;
        session?: { access_token: string; refresh_token: string };
      };
      if (!response.ok || !result.session) throw new Error(result.error || 'Invalid code');
      const supabase = await getSupabaseBrowserClient();
      await supabase.auth.setSession(result.session);
      router.replace('/home');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (email: string) => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Failed to send reset link');
      setMessage('Password reset link sent. Check your email.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset link');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = await getSupabaseBrowserClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/home`,
        },
      });
      if (oauthError) throw oauthError;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign in failed');
      setLoading(false);
    }
  };

  return (
    <>
      <LoginSignup
        mode={mode}
        onToggleMode={(next) => {
          setMode(next as AuthMode);
          setError(null);
          setMessage(null);
        }}
        onLogin={handleLogin}
        onRegister={handleRegister}
        onSendCode={handleSendOtp}
        onVerifyCode={handleVerifyOtp}
        onResetPassword={handleResetPassword}
        onGoogleSignIn={handleGoogleSignIn}
        loading={loading}
        error={error}
        message={message}
      />
      {registered && (
        <SubscriptionCelebration
          open={registered}
          autoShow={false}
          onClose={() => {
            setRegistered(false);
            setMode('login');
          }}
        />
      )}
    </>
  );
}
