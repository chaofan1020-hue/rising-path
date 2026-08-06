'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import LoginSignup, { type RegisterData } from '@/components/ui/login-signup';

type AuthMode = 'login' | 'signup' | 'otp' | 'reset';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
      const supabase = await getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;
      router.replace('/home');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (data: RegisterData) => {
    if (data.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const supabase = await getSupabaseBrowserClient();
      const { error: signUpError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: {
            first_name: data.firstName,
            last_name: data.lastName,
            username: data.username,
            role: data.role,
          },
        },
      });
      if (signUpError) throw signUpError;
      router.replace('/home');
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
      const supabase = await getSupabaseBrowserClient();
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
        },
      });
      if (otpError) throw otpError;
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
      const supabase = await getSupabaseBrowserClient();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: 'email',
      });
      if (verifyError) throw verifyError;
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
      const supabase = await getSupabaseBrowserClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email,
        {
          redirectTo: `${window.location.origin}/login`,
        }
      );
      if (resetError) throw resetError;
      setMessage('Password reset link sent. Check your email.');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to send reset link'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
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
      loading={loading}
      error={error}
      message={message}
    />
  );
}
