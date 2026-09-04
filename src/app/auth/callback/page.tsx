'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import type { EmailOtpType } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { type Locale, useLanguage } from '@/lib/language-context';

const EMAIL_OTP_TYPES = new Set<EmailOtpType>([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
]);

const CALLBACK_COPY: Record<Locale, { invalid: string; expired: string; back: string; finishing: string }> = {
  'zh-CN': { invalid: '验证链接无效或已过期，请返回登录页重新发送验证邮件。', expired: '验证链接已失效，请返回登录页重新发送验证邮件。', back: '返回登录', finishing: '正在完成验证...' },
  'zh-TW': { invalid: '驗證連結無效或已過期，請返回登入頁重新傳送驗證信。', expired: '驗證連結已失效，請返回登入頁重新傳送驗證信。', back: '返回登入', finishing: '正在完成驗證...' },
  en: { invalid: 'This verification link is invalid or expired. Return to sign in and request a new email.', expired: 'This verification link has expired. Return to sign in and request a new email.', back: 'Back to sign in', finishing: 'Finishing verification...' },
};

function getCallbackErrorMessage(error: unknown, copy: (typeof CALLBACK_COPY)[Locale]): string {
  if (!(error instanceof Error)) {
    return copy.invalid;
  }

  const message = error.message.toLowerCase();
  if (message === copy.invalid.toLowerCase()) return copy.invalid;
  if (
    message.includes('expired') ||
    message.includes('invalid') ||
    message.includes('already been used') ||
    message.includes('otp_expired') ||
    message.includes('验证链接无效') ||
    message.includes('验证链接已失效')
  ) {
    return copy.expired;
  }
  return /[\u3400-\u9fff]/.test(error.message) ? copy.invalid : error.message;
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const { locale } = useLanguage();
  const copy = CALLBACK_COPY[locale];
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const finish = async () => {
      try {
        // This page exchanges PKCE codes explicitly below. Disable the SDK's
        // URL detector here so a one-time OAuth code cannot be exchanged twice.
        const supabase = await getSupabaseBrowserClient({ detectSessionInUrl: false });
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
            throw new Error(copy.invalid);
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
          if (!data.session) throw new Error(copy.invalid);
        }
        const next = searchParams.get('next') || hashParams.get('next');
        const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/home';
        if (mounted) router.replace(safeNext);
      } catch (callbackError) {
        if (mounted) setError(getCallbackErrorMessage(callbackError, copy));
      }
    };
    void finish();
    return () => {
      mounted = false;
    };
  }, [copy, router]);

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center space-y-3">
        {error ? (
          <>
            <p className="text-sm text-destructive">{error}</p>
            <button className="text-sm underline" onClick={() => router.replace('/login')}>
              {copy.back}
            </button>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-6 w-6 animate-spin" />
            <p className="text-sm text-muted-foreground">{copy.finishing}</p>
          </>
        )}
      </div>
    </main>
  );
}
