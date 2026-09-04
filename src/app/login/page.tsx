'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import LoginSignup, { type RegisterData } from '@/components/ui/login-signup';
import RegistrationSuccess, { preloadRegistrationSuccess } from '@/components/RegistrationSuccess';
import { isEmailVerified, validatePassword } from '@/lib/auth-shared';
import { type Locale, useLanguage } from '@/lib/language-context';

type AuthMode = 'login' | 'signup' | 'otp' | 'reset' | 'password' | 'verify' | 'update-password';

const AUTH_FEEDBACK: Record<Locale, {
  verifyBeforeLogin: string;
  codeSentForSignup: string;
  signupNeedsVerification: string;
  verificationSuccess: string;
  emailSent: string;
  codeSent: string;
  resetSent: string;
  passwordsMismatch: string;
  acceptTerms: string;
  signInFailed: string;
  signUpFailed: string;
  invalidCode: string;
  updatePasswordFailed: string;
  githubFailed: string;
  signOutFailed: string;
  passwordRules: Record<string, string>;
}> = {
  'zh-CN': { verifyBeforeLogin: '请先完成邮箱验证，然后再登录。', codeSentForSignup: '邮箱验证码已发送，请在注册卡片中输入验证码完成注册。', signupNeedsVerification: '请先完成邮箱验证码验证', verificationSuccess: '邮箱验证成功，请设置新的登录密码。', emailSent: '验证邮件已发送，请检查你的邮箱。', codeSent: '验证码已发送，请检查你的邮箱。', resetSent: '密码重置邮件已发送，请检查你的邮箱。', passwordsMismatch: '两次输入的密码不一致', acceptTerms: '请先同意服务条款和隐私政策', signInFailed: '登录失败', signUpFailed: '注册失败', invalidCode: '验证码无效', updatePasswordFailed: '更新密码失败', githubFailed: 'GitHub 登录失败', signOutFailed: '退出登录失败', passwordRules: { '密码至少需要 12 位': '密码至少需要 12 位', '密码不能超过 128 位': '密码不能超过 128 位', '密码不能包含空格': '密码不能包含空格', '密码需要包含小写字母': '密码需要包含小写字母', '密码需要包含大写字母': '密码需要包含大写字母', '密码需要包含数字': '密码需要包含数字', '密码需要包含特殊字符': '密码需要包含特殊字符' } },
  'zh-TW': { verifyBeforeLogin: '請先完成信箱驗證，再登入。', codeSentForSignup: '信箱驗證碼已傳送，請在註冊卡片中輸入驗證碼完成註冊。', signupNeedsVerification: '請先完成信箱驗證碼驗證', verificationSuccess: '信箱驗證成功，請設定新的登入密碼。', emailSent: '驗證信已傳送，請檢查你的信箱。', codeSent: '驗證碼已傳送，請檢查你的信箱。', resetSent: '密碼重設信已傳送，請檢查你的信箱。', passwordsMismatch: '兩次輸入的密碼不一致', acceptTerms: '請先同意服務條款和隱私政策', signInFailed: '登入失敗', signUpFailed: '註冊失敗', invalidCode: '驗證碼無效', updatePasswordFailed: '更新密碼失敗', githubFailed: 'GitHub 登入失敗', signOutFailed: '登出失敗', passwordRules: { '密码至少需要 12 位': '密碼至少需要 12 位', '密码不能超过 128 位': '密碼不能超過 128 位', '密码不能包含空格': '密碼不能包含空格', '密码需要包含小写字母': '密碼需要包含小寫字母', '密码需要包含大写字母': '密碼需要包含大寫字母', '密码需要包含数字': '密碼需要包含數字', '密码需要包含特殊字符': '密碼需要包含特殊字元' } },
  en: { verifyBeforeLogin: 'Verify your email before signing in.', codeSentForSignup: 'A verification code was sent. Enter it here to finish registration.', signupNeedsVerification: 'Please verify your email code first.', verificationSuccess: 'Email verified. Set a new sign-in password.', emailSent: 'Verification email sent. Check your inbox.', codeSent: 'Code sent. Check your inbox.', resetSent: 'Password reset email sent. Check your inbox.', passwordsMismatch: 'Passwords do not match', acceptTerms: 'Please accept the terms and privacy policy', signInFailed: 'Sign in failed', signUpFailed: 'Sign up failed', invalidCode: 'Invalid code', updatePasswordFailed: 'Failed to update password', githubFailed: 'GitHub sign in failed', signOutFailed: 'Sign out failed', passwordRules: { '密码至少需要 12 位': 'Password must be at least 12 characters', '密码不能超过 128 位': 'Password cannot exceed 128 characters', '密码不能包含空格': 'Password cannot contain spaces', '密码需要包含小写字母': 'Password needs a lowercase letter', '密码需要包含大写字母': 'Password needs an uppercase letter', '密码需要包含数字': 'Password needs a number', '密码需要包含特殊字符': 'Password needs a special character' } },
};

const AUTH_ERROR_TRANSLATIONS: Record<Locale, Record<string, string>> = {
  'zh-CN': {},
  'zh-TW': {
    '请输入有效的邮箱地址': '請輸入有效的信箱地址',
    '请输入邮箱和密码': '請輸入信箱和密碼',
    '用户名长度需要在 2 到 40 个字符之间': '使用者名稱長度需介於 2 到 40 個字元',
    '注册请求过于频繁，请稍后再试': '註冊請求過於頻繁，請稍後再試',
    '登录尝试过于频繁，请稍后再试': '登入嘗試過於頻繁，請稍後再試',
    '请求过于频繁，请稍后再试': '請求過於頻繁，請稍後再試',
    '验证尝试过于频繁，请稍后再试': '驗證嘗試過於頻繁，請稍後再試',
    '发送过于频繁，请稍后再试': '傳送過於頻繁，請稍後再試',
    '发送失败，请稍后重试': '傳送失敗，請稍後重試',
    '验证码发送失败，请稍后重试': '驗證碼傳送失敗，請稍後重試',
    '验证码验证失败，请稍后重试': '驗證碼驗證失敗，請稍後重試',
    '邮箱验证失败，请稍后重试': '信箱驗證失敗，請稍後重試',
    '注册失败，请稍后重试': '註冊失敗，請稍後重試',
    '登录失败，请稍后重试': '登入失敗，請稍後重試',
    '请求失败，请稍后重试': '請求失敗，請稍後重試',
    '邮箱或密码不正确': '信箱或密碼不正確',
    '请先完成邮箱验证': '請先完成信箱驗證',
    '该邮箱尚未注册，请先使用“创建账户”完成注册': '此信箱尚未註冊，請先使用「建立帳號」完成註冊',
    '该邮箱已注册，请直接登录': '此信箱已註冊，請直接登入',
    '密码不符合安全要求': '密碼不符合安全要求',
    '验证码无效或已过期，请重新发送': '驗證碼無效或已過期，請重新傳送',
    '验证邮件发送失败，请稍后重试；若持续失败请检查 Supabase SMTP 配置': '驗證信傳送失敗，請稍後重試；若持續失敗，請檢查 Supabase SMTP 設定',
  },
  en: {
    '请输入有效的邮箱地址': 'Enter a valid email address',
    '请输入邮箱和密码': 'Enter your email and password',
    '用户名长度需要在 2 到 40 个字符之间': 'Your name must be between 2 and 40 characters',
    '注册请求过于频繁，请稍后再试': 'Too many registration attempts. Please try again later.',
    '登录尝试过于频繁，请稍后再试': 'Too many sign-in attempts. Please try again later.',
    '请求过于频繁，请稍后再试': 'Too many requests. Please try again later.',
    '验证尝试过于频繁，请稍后再试': 'Too many verification attempts. Please try again later.',
    '发送过于频繁，请稍后再试': 'Too many messages sent. Please try again later.',
    '发送失败，请稍后重试': 'Could not send the email. Please try again later.',
    '验证码发送失败，请稍后重试': 'Could not send the code. Please try again later.',
    '验证码验证失败，请稍后重试': 'Could not verify the code. Please try again later.',
    '邮箱验证失败，请稍后重试': 'Email verification failed. Please try again later.',
    '注册失败，请稍后重试': 'Sign up failed. Please try again later.',
    '登录失败，请稍后重试': 'Sign in failed. Please try again later.',
    '请求失败，请稍后重试': 'Request failed. Please try again later.',
    '获取 Supabase 配置失败': 'Could not load the authentication configuration.',
    '邮箱或密码不正确': 'Incorrect email or password',
    '请先完成邮箱验证': 'Verify your email before signing in.',
    '该邮箱尚未注册，请先使用“创建账户”完成注册': 'This email is not registered. Create an account first.',
    '该邮箱已注册，请直接登录': 'This email is already registered. Sign in instead.',
    '密码不符合安全要求': 'Password does not meet the security requirements.',
    '验证码无效或已过期，请重新发送': 'The code is invalid or expired. Please send a new one.',
    '验证邮件发送失败，请稍后重试；若持续失败请检查 Supabase SMTP 配置': 'The verification email could not be sent. Check the Supabase SMTP configuration if this continues.',
  },
};

function localizeAuthError(error: string | undefined, feedback: (typeof AUTH_FEEDBACK)[Locale], fallback: string, locale: Locale): string {
  if (!error) return fallback;
  const known: Record<string, string> = {
    '请先完成邮箱验证': feedback.verifyBeforeLogin,
    '请先完成邮箱验证码验证': feedback.signupNeedsVerification,
    '邮箱验证码无效或已过期': feedback.invalidCode,
    '验证码无效或已过期': feedback.invalidCode,
  };
  if (known[error]) return known[error];
  if (AUTH_ERROR_TRANSLATIONS[locale][error]) return AUTH_ERROR_TRANSLATIONS[locale][error];
  // Do not leak a server-side Chinese fallback into the English auth UI.
  if (locale === 'en' && /[\u3400-\u9fff]/.test(error)) return fallback;
  return error;
}

export default function LoginPage() {
  const router = useRouter();
  const { locale } = useLanguage();
  const feedback = AUTH_FEEDBACK[locale];
  const localizePasswordError = (value: string | null) => value ? (feedback.passwordRules[value] || value) : null;
  const [mode, setMode] = useState<AuthMode>('password');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showRegistrationSuccess, setShowRegistrationSuccess] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState('');
  const [registrationName, setRegistrationName] = useState('');

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
    }).catch((error: unknown) => {
      if (mounted) setError(localizeAuthError(error instanceof Error ? error.message : undefined, feedback, feedback.signInFailed, locale));
    });
    return () => {
      mounted = false;
    };
  }, [feedback, locale, router]);

  useEffect(() => {
    // Begin downloading the 3D success card while the auth form is visible.
    // Registration mode keeps this warm; starting on mount also covers users
    // who switch to sign-up and submit quickly.
    preloadRegistrationSuccess();
  }, []);

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
          setMessage(feedback.verifyBeforeLogin);
          return;
        }
        throw new Error(localizeAuthError(result.error, feedback, feedback.signInFailed, locale));
      }
      const supabase = await getSupabaseBrowserClient();
      const { error: sessionError } = await supabase.auth.setSession(result.session);
      if (sessionError) throw sessionError;
      router.replace('/home');
    } catch (err) {
      setError(localizeAuthError(err instanceof Error ? err.message : undefined, feedback, feedback.signInFailed, locale));
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (data: RegisterData) => {
    const passwordError = validatePassword(data.password);
    if (passwordError) {
      setError(localizePasswordError(passwordError));
      return;
    }
    if (data.confirmPassword !== data.password) {
      setError(feedback.passwordsMismatch);
      return;
    }
    if (!data.terms) {
      setError(feedback.acceptTerms);
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
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        requiresEmailConfirmation?: boolean;
      };
      if (!response.ok) throw new Error(localizeAuthError(result.error, feedback, feedback.signUpFailed, locale));
      if (!result.requiresEmailConfirmation) {
        throw new Error(feedback.signupNeedsVerification);
      }
      setRegistrationName(data.username.trim());
      setVerificationEmail(data.email);
      setMessage(feedback.codeSentForSignup);
    } catch (err) {
      setError(localizeAuthError(err instanceof Error ? err.message : undefined, feedback, feedback.signUpFailed, locale));
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async (email: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/auth/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(localizeAuthError(result.error, feedback, feedback.emailSent, locale));
      }
      setMessage(feedback.emailSent);
      return true;
    } catch (err) {
      setError(localizeAuthError(err instanceof Error ? err.message : undefined, feedback, 'Failed to resend verification email', locale));
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
      if (!response.ok) throw new Error(localizeAuthError(result.error, feedback, feedback.codeSent, locale));
      setMessage(feedback.codeSent);
      return true;
    } catch (err) {
      setError(localizeAuthError(err instanceof Error ? err.message : undefined, feedback, 'Failed to send code', locale));
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
      if (!response.ok || !result.session) throw new Error(localizeAuthError(result.error, feedback, feedback.invalidCode, locale));
      const supabase = await getSupabaseBrowserClient();
      const { error: sessionError } = await supabase.auth.setSession(result.session);
      if (sessionError) throw sessionError;
      setMode('update-password');
      setMessage(feedback.verificationSuccess);
    } catch (err) {
      setError(localizeAuthError(err instanceof Error ? err.message : undefined, feedback, feedback.invalidCode, locale));
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
        throw new Error(localizeAuthError(result.error, feedback, feedback.invalidCode, locale));
      }
      const supabase = await getSupabaseBrowserClient();
      const { error: sessionError } = await supabase.auth.setSession(result.session);
      if (sessionError) throw sessionError;
      setShowRegistrationSuccess(true);
    } catch (err) {
      setError(localizeAuthError(err instanceof Error ? err.message : undefined, feedback, feedback.invalidCode, locale));
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (password: string, confirmPassword: string) => {
    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(localizePasswordError(passwordError));
      return;
    }
    if (password !== confirmPassword) {
      setError(feedback.passwordsMismatch);
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
      setError(localizeAuthError(err instanceof Error ? err.message : undefined, feedback, feedback.updatePasswordFailed, locale));
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
      if (!response.ok) throw new Error(localizeAuthError(result.error, feedback, feedback.resetSent, locale));
      setMessage(feedback.resetSent);
    } catch (err) {
      setError(localizeAuthError(err instanceof Error ? err.message : undefined, feedback, feedback.updatePasswordFailed, locale));
    } finally {
      setLoading(false);
    }
  };

  const handleGithubSignIn = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const supabase = await getSupabaseBrowserClient();
      // OAuth redirect URLs must stay canonical. A callback generated from a
      // www/legacy hostname is rejected when Supabase only allows the apex domain.
      const appOrigin = window.location.hostname === 'localhost'
        ? window.location.origin
        : 'https://liorvix.com';
      const redirectUrl = new URL('/auth/callback', appOrigin);
      redirectUrl.searchParams.set('next', '/home');
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: redirectUrl.toString(),
        },
      });
      if (oauthError) throw oauthError;
    } catch (err) {
      setError(localizeAuthError(err instanceof Error ? err.message : undefined, feedback, feedback.githubFailed, locale));
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setLoading(true);
    try {
      const supabase = await getSupabaseBrowserClient();
      await supabase.auth.signOut();
      setVerificationEmail('');
      setRegistrationName('');
      setMode('password');
      setError(null);
      setMessage(null);
    } catch (err) {
      setError(localizeAuthError(err instanceof Error ? err.message : undefined, feedback, feedback.signOutFailed, locale));
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
        onGithubSignIn={handleGithubSignIn}
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
          {locale === 'en' ? 'Preview success card' : locale === 'zh-TW' ? '測試卡片展示' : '测试卡片展示'}
        </button>
      )}
      {showRegistrationSuccess && (
        <RegistrationSuccess
          displayName={registrationName}
          onContinue={() => {
            setShowRegistrationSuccess(false);
            router.replace('/home');
          }}
        />
      )}
    </>
  );
}
