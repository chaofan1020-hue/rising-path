'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import type { EmailOtpType } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { getPostLoginDestination } from '@/lib/onboarding';

const EMAIL_OTP_TYPES = new Set<EmailOtpType>([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
]);

function getCallbackErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return '验证链接无效或已过期，请返回登录页重新发送验证邮件。';
  }

  const message = error.message.toLowerCase();
  if (
    message.includes('expired') ||
    message.includes('invalid') ||
    message.includes('already been used') ||
    message.includes('otp_expired') ||
    message.includes('验证链接无效') ||
    message.includes('验证链接已失效')
  ) {
    return '验证链接已失效，请返回登录页重新发送验证邮件。';
  }
  return error.message;
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const finish = async () => {
      try {
        const supabase = await getSupabaseBrowserClient();
        const searchParams = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const callbackError =
          searchParams.get('error_description') ||
          searchParams.get('error') ||
          hashParams.get('error_description') ||
          hashParams.get('error');
        if (callbackError) throw new Error(callbackError);
        const code = searchParams.get('code');
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else if (searchParams.get('token_hash')) {
          const type = searchParams.get('type');
          if (!type || !EMAIL_OTP_TYPES.has(type as EmailOtpType)) {
            throw new Error('验证链接无效或已过期');
          }
          const { error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: searchParams.get('token_hash')!,
            type: type as EmailOtpType,
          });
          if (verifyError) throw verifyError;
        } else if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) throw sessionError;
        } else {
          const { data, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) throw sessionError;
          if (!data.session) throw new Error('验证链接无效或已过期');
        }
        const next = searchParams.get('next') || hashParams.get('next');
        let safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '';
        if (!safeNext || safeNext === '/home') {
          safeNext = await getPostLoginDestination();
        }
        if (mounted) router.replace(safeNext);
      } catch (callbackError) {
        if (mounted) setError(getCallbackErrorMessage(callbackError));
      }
    };
    void finish();
    return () => {
      mounted = false;
    };
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center space-y-3">
        {error ? (
          <>
            <p className="text-sm text-destructive">{error}</p>
            <button className="text-sm underline" onClick={() => router.replace('/login')}>
              返回登录
            </button>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-6 w-6 animate-spin" />
            <p className="text-sm text-muted-foreground">正在完成验证...</p>
          </>
        )}
      </div>
    </main>
  );
}
