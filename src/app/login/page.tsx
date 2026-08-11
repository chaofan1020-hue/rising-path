'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import LoginSignup, { type RegisterData } from '@/components/ui/login-signup';
import RegistrationSuccess from '@/components/RegistrationSuccess';
import { isEmailVerified, validatePassword } from '@/lib/auth-shared';

type AuthMode = 'login' | 'signup' | 'otp' | 'reset' | 'password' | 'verify' | 'update-password';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showRegistrationSuccess, setShowRegistrationSuccess] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState('');

  useEffect(() => {
    let mounted = true;
    const searchParams = new URLSearchParams(window.location.search);
    const requestedMode = searchParams.get('mode');
    const verificationRequested = searchParams.get('verify') === '1';
    if (requestedMode === 'update-password') {
      setMode('update-password');
      return () => {
        mounted = false;
      };
    }

    if (verificationRequested) setMode('verify');

    getSupabaseBrowserClient().then(async (supabase) => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;

      if (data.session?.user && !isEmailVerified(data.session.user)) {
        setVerificationEmail(data.session.user.email ?? '');
        setMode('verify');
      } else if (data.session) {
        router.replace('/home');
      } else if (verificationRequested) {
        setMode('verify');
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
        if (result.error === '请先完成邮箱验证') {
          setVerificationEmail(email);
          setMode('verify');
          setMessage('请先完成邮箱验证，然后再登录。');
          return;
        }
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
      const result = (await response.json()) as {
        error?: string;
        requiresEmailConfirmation?: boolean;
      };
      if (!response.ok) throw new Error(result.error || 'Sign up failed');
      if (!result.requiresEmailConfirmation) {
        throw new Error('请先完成邮箱验证码验证');
      }
      setVerificationEmail(data.email);
      setMode('verify');
      setMessage('A confirmation code was sent to your email.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async (
    email: string,
    captchaToken: string | null,
  ): Promise<boolean> => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/auth/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, captchaToken }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error || 'Failed to resend verification email');
      }
      setMessage('Verification email sent. Check your inbox.');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend verification email');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async (email: string): Promise<boolean> => {
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
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (email: string, otp: string) => {
    setLoading(true);
    setError(null);
    setMessage(null);
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
      const { error: sessionError } = await supabase.auth.setSession(result.session);
      if (sessionError) throw sessionError;
      router.replace('/home');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifySignupCode = async (email: string, code: string) => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/auth/signup/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token: code }),
      });
      const result = (await response.json()) as {
        error?: string;
        session?: { access_token: string; refresh_token: string };
      };
      if (!response.ok || !result.session) {
        throw new Error(result.error || 'Invalid verification code');
      }
      const supabase = await getSupabaseBrowserClient();
      const { error: sessionError } = await supabase.auth.setSession(result.session);
      if (sessionError) throw sessionError;
      setShowRegistrationSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (password: string, confirmPassword: string) => {
    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const supabase = await getSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      router.replace('/home');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password');
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
    setMessage(null);
    try {
      const supabase = await getSupabaseBrowserClient();
      const redirectUrl = new URL('/auth/callback', window.location.origin);
      redirectUrl.searchParams.set('next', '/home');
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl.toString(),
        },
      });
      if (oauthError) throw oauthError;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign in failed');
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setLoading(true);
    try {
      const supabase = await getSupabaseBrowserClient();
      await supabase.auth.signOut();
      setVerificationEmail('');
      setMode('login');
      setError(null);
      setMessage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign out failed');
    } finally {
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
          if (next !== 'otp') setMessage(null);
        }}
        onLogin={handleLogin}
        onRegister={handleRegister}
        onSendCode={handleSendOtp}
        onVerifyCode={handleVerifyOtp}
        onVerifySignupCode={handleVerifySignupCode}
        onResendVerification={handleResendVerification}
        onResetPassword={handleResetPassword}
        onGoogleSignIn={handleGoogleSignIn}
        onSignOut={handleSignOut}
        onUpdatePassword={handleUpdatePassword}
        verificationEmail={verificationEmail}
        loading={loading}
        error={error}
        message={message}
      />
      {process.env.NODE_ENV === 'development' && (
        <button
          type="button"
          onClick={() => setShowRegistrationSuccess(true)}
          className="fixed bottom-4 left-4 z-[10000] rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground shadow-sm transition-colors hover:bg-muted"
        >
          测试卡片展示
        </button>
      )}
      {showRegistrationSuccess && (
        <RegistrationSuccess
          onContinue={() => {
            setShowRegistrationSuccess(false);
            router.replace('/home');
          }}
        />
      )}
    </>
  );
}
