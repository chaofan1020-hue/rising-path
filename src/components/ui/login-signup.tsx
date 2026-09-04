'use client';

import { LanguageSwitcher } from '@/components/language-switcher';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { type Locale, useLanguage } from '@/lib/language-context';
import { Eye, EyeOff, Github, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, JSX, SVGProps, useEffect, useState } from 'react';

const Logo = (props: JSX.IntrinsicAttributes & SVGProps<SVGSVGElement>) => (
  <svg fill="currentColor" height="48" viewBox="0 0 40 48" width="40" {...props}>
    <clipPath id="liorvix-auth-logo">
      <path d="m0 0h40v48h-40z" />
    </clipPath>
    <g clipPath="url(#liorvix-auth-logo)">
      <path d="m25.0887 5.05386-3.933-1.05386-3.3145 12.3696-2.9923-11.16736-3.9331 1.05386 3.233 12.0655-8.05262-8.0526-2.87919 2.8792 8.83271 8.8328-10.99975-2.9474-1.05385625 3.933 12.01860625 3.2204c-.1376-.5935-.2104-1.2119-.2104-1.8473 0-4.4976 3.646-8.1436 8.1437-8.1436 4.4976 0 8.1436 3.646 8.1436 8.1436 0 .6313-.0719 1.2459-.2078 1.8359l10.9227 2.9267 1.0538-3.933-12.0664-3.2332 11.0005-2.9476-1.0539-3.933-12.0659 3.233 8.0526-8.0526-2.8792-2.87916-8.7102 8.71026z" />
      <path d="m27.8723 26.2214c-.3372 1.4256-1.0491 2.7063-2.0259 3.7324l7.913 7.9131 2.8792-2.8792z" />
      <path d="m25.7665 30.0366c-.9886 1.0097-2.2379 1.7632-3.6389 2.1515l2.8794 10.746 3.933-1.0539z" />
      <path d="m21.9807 32.2274c-.65.1671-1.3313.2559-2.0334.2559-.7522 0-1.4806-.102-2.1721-.2929l-2.882 10.7558 3.933 1.0538z" />
      <path d="m17.6361 32.1507c-1.3796-.4076-2.6067-1.1707-3.5751-2.1833l-7.9325 7.9325 2.87919 2.8792z" />
      <path d="m13.9956 29.8973c-.9518-1.019-1.6451-2.2826-1.9751-3.6862l-10.95836 2.9363 1.05385 3.933z" />
    </g>
  </svg>
);

export interface RegisterData {
  email: string;
  password: string;
  username: string;
  confirmPassword: string;
  terms: boolean;
}

type AuthMode = 'login' | 'signup' | 'otp' | 'reset' | 'password' | 'verify' | 'update-password';

type AuthCopy = {
  signInTitle: string;
  signInSubtitle: string;
  signUpTitle: string;
  signUpSubtitle: string;
  email: string;
  emailPlaceholder: string;
  password: string;
  confirmPassword: string;
  username: string;
  usernamePlaceholder: string;
  forgotPassword: string;
  signIn: string;
  continueGithub: string;
  createAccount: string;
  completeRegistration: string;
  sendSignupCode: string;
  resendSignupCode: string;
  alreadyAccount: string;
  or: string;
  agreePrefix: string;
  terms: string;
  and: string;
  conditions: string;
  otpTitle: string;
  sendCode: string;
  verificationCode: string;
  verifyCode: string;
  backToSignIn: string;
  resetTitle: string;
  sendResetLink: string;
  verifyTitle: string;
  verifyDescription: string;
  confirmationCode: string;
  verifyEmail: string;
  resendConfirmation: string;
  resendIn: (seconds: number) => string;
  useAnotherEmail: string;
  updateTitle: string;
  newPassword: string;
  updatePassword: string;
  welcome: string;
  showPassword: string;
  hidePassword: string;
};

const AUTH_COPY: Record<Locale, AuthCopy> = {
  'zh-CN': {
    signInTitle: '使用密码登录', signInSubtitle: '', signUpTitle: '注册账号', signUpSubtitle: '填写信息后，通过邮箱验证码完成注册', email: '邮箱地址', emailPlaceholder: 'name@example.com', password: '密码', confirmPassword: '确认密码', username: '你的名字', usernamePlaceholder: '输入你希望展示的名字', forgotPassword: '忘记密码？通过重置邮件设置新密码', signIn: '登录', continueGithub: '使用 GitHub 继续', createAccount: '注册', completeRegistration: '完成注册', sendSignupCode: '发送邮箱验证码', resendSignupCode: '重新发送验证码', alreadyAccount: '已经有账号了？', or: '或', agreePrefix: '注册即表示你同意我们的', terms: '服务条款', and: '和', conditions: '隐私政策', otpTitle: '邮箱验证重置密码', sendCode: '发送验证码', verificationCode: '邮箱验证码', verifyCode: '验证并设置新密码', backToSignIn: '返回密码登录', resetTitle: '重置密码', sendResetLink: '发送重置邮件', verifyTitle: '完成邮箱验证', verifyDescription: '输入邮箱中的验证码后，账号才会注册成功。', confirmationCode: '邮箱验证码', verifyEmail: '验证并完成注册', resendConfirmation: '重新发送验证码', resendIn: (seconds) => `${seconds} 秒后可重新发送`, useAnotherEmail: '使用其他邮箱', updateTitle: '设置新密码', newPassword: '新密码', updatePassword: '更新密码并登录', welcome: '验证成功后，请设置新的登录密码。', showPassword: '显示密码', hidePassword: '隐藏密码',
  },
  'zh-TW': {
    signInTitle: '使用密碼登入', signInSubtitle: '', signUpTitle: '註冊帳號', signUpSubtitle: '填寫資料後，透過信箱驗證碼完成註冊', email: '電子郵件', emailPlaceholder: 'name@example.com', password: '密碼', confirmPassword: '確認密碼', username: '你的名字', usernamePlaceholder: '輸入你希望顯示的名字', forgotPassword: '忘記密碼？透過重設郵件設定新密碼', signIn: '登入', continueGithub: '使用 GitHub 繼續', createAccount: '註冊', completeRegistration: '完成註冊', sendSignupCode: '傳送信箱驗證碼', resendSignupCode: '重新傳送驗證碼', alreadyAccount: '已經有帳號了？', or: '或', agreePrefix: '註冊即表示你同意我們的', terms: '服務條款', and: '和', conditions: '隱私政策', otpTitle: '信箱驗證重設密碼', sendCode: '傳送驗證碼', verificationCode: '信箱驗證碼', verifyCode: '驗證並設定新密碼', backToSignIn: '返回密碼登入', resetTitle: '重設密碼', sendResetLink: '傳送重設郵件', verifyTitle: '完成信箱驗證', verifyDescription: '輸入信箱中的驗證碼後，帳號才會註冊成功。', confirmationCode: '信箱驗證碼', verifyEmail: '驗證並完成註冊', resendConfirmation: '重新傳送驗證碼', resendIn: (seconds) => `${seconds} 秒後可重新傳送`, useAnotherEmail: '使用其他信箱', updateTitle: '設定新密碼', newPassword: '新密碼', updatePassword: '更新密碼並登入', welcome: '驗證成功後，請設定新的登入密碼。', showPassword: '顯示密碼', hidePassword: '隱藏密碼',
  },
  en: {
    signInTitle: 'Sign in with password', signInSubtitle: '', signUpTitle: 'Register your account', signUpSubtitle: 'Verify your email to complete registration', email: 'Email address', emailPlaceholder: 'name@example.com', password: 'Password', confirmPassword: 'Confirm password', username: 'Your name', usernamePlaceholder: 'Enter the name you want to display', forgotPassword: 'Forgot password? Reset by email', signIn: 'Sign in', continueGithub: 'Continue with GitHub', createAccount: 'Register', completeRegistration: 'Complete registration', sendSignupCode: 'Send email verification code', resendSignupCode: 'Resend verification code', alreadyAccount: 'Already have an account?', or: 'or', agreePrefix: 'By creating an account, you agree to our', terms: 'Terms of Service', and: 'and', conditions: 'Privacy Policy', otpTitle: 'Verify email to reset password', sendCode: 'Send code', verificationCode: 'Email verification code', verifyCode: 'Verify and set new password', backToSignIn: 'Back to password sign in', resetTitle: 'Reset your password', sendResetLink: 'Send reset email', verifyTitle: 'Complete email verification', verifyDescription: 'Your account is registered only after the email code is verified.', confirmationCode: 'Email verification code', verifyEmail: 'Verify and finish registration', resendConfirmation: 'Resend verification code', resendIn: (seconds) => `Resend in ${seconds}s`, useAnotherEmail: 'Use another email', updateTitle: 'Set a new password', newPassword: 'New password', updatePassword: 'Update password and sign in', welcome: 'Verification complete. Set a new password to continue.', showPassword: 'Show password', hidePassword: 'Hide password',
  },
};

const AUTH_PAGE_CLASS = 'relative flex min-h-screen items-center justify-center px-4 py-10';
const AUTH_PANEL_CLASS = 'w-full max-w-sm';
const PRIMARY_BUTTON_CLASS = 'w-full bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200';
const INPUT_CLASS = 'text-foreground';

interface LoginSignupProps {
  mode: AuthMode;
  onToggleMode: (mode: AuthMode) => void;
  onLogin: (email: string, password: string) => void | Promise<void>;
  onRegister: (data: RegisterData) => void | Promise<void>;
  onSendCode: (email: string) => void | Promise<boolean>;
  onVerifyCode: (email: string, code: string) => void | Promise<void>;
  onVerifySignupCode: (email: string, code: string) => void | Promise<void>;
  onResendVerification: (email: string) => void | Promise<boolean>;
  onResetPassword: (email: string) => void | Promise<void>;
  onGithubSignIn: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
  onUpdatePassword: (password: string, confirmPassword: string) => void | Promise<void>;
  verificationEmail?: string;
  loading?: boolean;
  error?: string | null;
  message?: string | null;
}

function AuthLanguageControl() {
  return (
    <div className="absolute right-4 top-4 z-20 rounded-full border border-border/70 bg-background/80 px-1 shadow-sm backdrop-blur sm:right-6 sm:top-6">
      <LanguageSwitcher />
    </div>
  );
}

function AuthPage({ children }: { children: React.ReactNode }) {
  return (
    <main className={AUTH_PAGE_CLASS}>
      <AuthLanguageControl />
      {children}
    </main>
  );
}

function AuthHeader({ title, subtitle, showLogo = false }: { title: string; subtitle?: string; showLogo?: boolean }) {
  return (
    <header className={`${showLogo ? 'mb-0' : 'mb-6'} text-center`}>
      {showLogo && <Logo className="mx-auto h-12 w-12 text-foreground" />}
      <h2 className={`${showLogo ? 'mt-3 text-2xl text-foreground' : 'text-xl text-foreground'} font-semibold`}>{title}</h2>
      {subtitle && <p className={`${showLogo ? 'text-foreground' : 'mt-1 text-sm text-foreground'}`}>{subtitle}</p>}
    </header>
  );
}

function AuthMessages({ error, message }: Pick<LoginSignupProps, 'error' | 'message'>) {
  return (
    <>
      {error && <p role="alert" className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-sm leading-5 text-foreground dark:bg-primary/15">{error}</p>}
      {message && <p role="status" className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-sm leading-5 text-foreground dark:bg-primary/15">{message}</p>}
    </>
  );
}

function PasswordInput({ id, label, value, onChange, autoComplete, visible, onToggle, required = true }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  visible: boolean;
  onToggle: () => void;
  required?: boolean;
}) {
  const { locale } = useLanguage();
  const copy = AUTH_COPY[locale];
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-medium text-foreground">{label}</Label>
      <div className="relative">
        <Input id={id} name={id} type={visible ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} className={`${INPUT_CLASS} pr-11`} required={required} minLength={autoComplete === 'current-password' ? undefined : 12} maxLength={128} />
        <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-full px-3 text-foreground hover:bg-transparent" onClick={onToggle} aria-label={visible ? copy.hidePassword : copy.showPassword}>
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

function BackToSignIn({ children, onClick }: { children: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="text-sm text-foreground underline underline-offset-4 transition-colors hover:text-muted-foreground">{children}</button>;
}

export default function LoginSignup({
  mode,
  onToggleMode,
  onLogin,
  onRegister,
  onSendCode,
  onVerifyCode,
  onVerifySignupCode,
  onResendVerification,
  onResetPassword,
  onGithubSignIn,
  onSignOut,
  onUpdatePassword,
  verificationEmail,
  loading,
  error,
  message,
}: LoginSignupProps) {
  const { locale } = useLanguage();
  const copy = AUTH_COPY[locale];
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', confirmPassword: '', code: '', username: '', terms: false });
  const [signupResendSeconds, setSignupResendSeconds] = useState(0);
  const [otpResendSeconds, setOtpResendSeconds] = useState(0);
  const signupVerificationSent = mode === 'signup' && Boolean(verificationEmail && form.email === verificationEmail);

  useEffect(() => {
    setForm((previous) => previous.email === (verificationEmail ?? '') ? previous : { ...previous, email: verificationEmail ?? '', code: '' });
  }, [verificationEmail]);

  useEffect(() => {
    if (verificationEmail) setSignupResendSeconds(60);
  }, [verificationEmail]);

  useEffect(() => {
    if (signupResendSeconds <= 0) return;
    const timer = window.setInterval(() => setSignupResendSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [signupResendSeconds]);

  useEffect(() => {
    if (otpResendSeconds <= 0) return;
    const timer = window.setInterval(() => setOtpResendSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [otpResendSeconds]);

  const update = (key: keyof typeof form, value: string | boolean) => setForm((previous) => ({ ...previous, [key]: value }));
  const handleLoginSubmit = (event: FormEvent) => { event.preventDefault(); onLogin(form.email, form.password); };
  const handleRegisterSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (signupVerificationSent) {
      onVerifySignupCode(form.email, form.code);
      return;
    }
    onRegister({ email: form.email, password: form.password, username: form.username, confirmPassword: form.confirmPassword, terms: form.terms });
  };
  const handleVerifyCode = (event: FormEvent) => { event.preventDefault(); onVerifyCode(form.email, form.code); };
  const resendSignupCode = async () => {
    if (signupResendSeconds > 0) return;
    const sent = await onResendVerification(form.email);
    if (sent !== false) setSignupResendSeconds(60);
  };
  const sendOtpCode = async () => {
    if (otpResendSeconds > 0) return;
    const sent = await onSendCode(form.email);
    if (sent !== false) setOtpResendSeconds(60);
  };
  const handleResendVerification = (event: FormEvent) => { event.preventDefault(); void resendSignupCode(); };
  const handleReset = (event: FormEvent) => { event.preventDefault(); onResetPassword(form.email); };
  const handleUpdatePassword = (event: FormEvent) => { event.preventDefault(); onUpdatePassword(form.password, form.confirmPassword); };

  if (mode === 'signup') {
    return (
      <AuthPage>
        <section className="w-full max-w-md">
          <Card className="border-none pb-0 shadow-lg">
          <CardHeader className="flex flex-col items-center space-y-1.5 pb-4 pt-6"><AuthHeader title={copy.signUpTitle} subtitle={copy.signUpSubtitle} showLogo /></CardHeader>
          <form onSubmit={handleRegisterSubmit} noValidate>
          <CardContent className="space-y-5 px-8">
            <AuthMessages error={error} message={message} />
            <div className="space-y-2"><Label htmlFor="username" className="text-sm font-medium">{copy.username}</Label><Input id="username" autoComplete="username" value={form.username} onChange={(event) => update('username', event.target.value)} placeholder={copy.usernamePlaceholder} className={INPUT_CLASS} required /></div>
            <div className="space-y-2"><Label htmlFor="email" className="text-sm font-medium">{copy.email}</Label><Input id="email" type="email" autoComplete="email" value={form.email} onChange={(event) => update('email', event.target.value)} placeholder={copy.emailPlaceholder} className={INPUT_CLASS} required /></div>
            <PasswordInput id="password" label={copy.password} value={form.password} onChange={(value) => update('password', value)} autoComplete="new-password" visible={showPassword} onToggle={() => setShowPassword((current) => !current)} />
            <PasswordInput id="confirm-password" label={copy.confirmPassword} value={form.confirmPassword} onChange={(value) => update('confirmPassword', value)} autoComplete="new-password" visible={showConfirmPassword} onToggle={() => setShowConfirmPassword((current) => !current)} />
            {signupVerificationSent && <div className="space-y-2 rounded-lg border border-primary/25 bg-primary/5 p-3 dark:bg-primary/15"><div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"><Label htmlFor="signup-inline-code" className="text-sm font-medium">{copy.confirmationCode}</Label><Button type="button" variant="ghost" className="h-auto px-0 text-xs text-foreground underline underline-offset-4" onClick={() => void resendSignupCode()} disabled={loading || signupResendSeconds > 0}>{signupResendSeconds > 0 ? copy.resendIn(signupResendSeconds) : copy.resendSignupCode}</Button></div><Input id="signup-inline-code" autoComplete="one-time-code" inputMode="numeric" value={form.code} onChange={(event) => update('code', event.target.value)} placeholder="123456" className={`${INPUT_CLASS} font-mono tracking-[0.18em]`} required /></div>}
            <div className="flex items-center space-x-2"><Checkbox id="terms" checked={form.terms} onCheckedChange={(value) => update('terms', Boolean(value))} required /><label htmlFor="terms" className="text-sm text-foreground">{copy.agreePrefix} <Link href="#" className="text-foreground underline underline-offset-4">{copy.terms}</Link> {copy.and} <Link href="/privacy-policy" className="text-foreground underline underline-offset-4">{copy.conditions}</Link></label></div>
            <Button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={loading || !form.terms || (signupVerificationSent && !form.code)}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : signupVerificationSent ? copy.completeRegistration : copy.sendSignupCode}</Button>
          </CardContent>
          </form>
          <CardFooter className="flex justify-center border-t !py-4"><p className="text-center text-sm text-foreground">{copy.alreadyAccount} <BackToSignIn onClick={() => onToggleMode('password')}>{copy.signIn}</BackToSignIn></p></CardFooter>
          </Card>
        </section>
      </AuthPage>
    );
  }

  if (mode === 'otp') {
    return (
      <AuthPage>
        <section className={AUTH_PANEL_CLASS}>
          <AuthHeader title={copy.otpTitle} subtitle={copy.signInSubtitle} />
          <form onSubmit={handleVerifyCode} className="space-y-4" noValidate>
            <AuthMessages error={error} message={message} />
            <div className="space-y-2"><Label htmlFor="otp-email" className="text-sm font-medium">{copy.email}</Label><Input id="otp-email" type="email" autoComplete="email" value={form.email} onChange={(event) => update('email', event.target.value)} placeholder={copy.emailPlaceholder} className={INPUT_CLASS} required /></div>
            <Button type="button" variant="outline" className="w-full text-foreground dark:text-white hover:!bg-zinc-100 hover:!text-foreground hover:!border-zinc-300 dark:hover:!bg-zinc-800 dark:hover:!text-white" onClick={() => void sendOtpCode()} disabled={loading || !form.email || otpResendSeconds > 0}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : otpResendSeconds > 0 ? copy.resendIn(otpResendSeconds) : copy.sendCode}</Button>
            <div className="space-y-2"><Label htmlFor="code" className="text-sm font-medium">{copy.verificationCode}</Label><Input id="code" autoComplete="one-time-code" inputMode="numeric" value={form.code} onChange={(event) => update('code', event.target.value)} placeholder="123456" className={`${INPUT_CLASS} font-mono tracking-[0.18em]`} required /></div>
            <Button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={loading || !form.code}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : copy.verifyCode}</Button>
          </form>
          <p className="mt-6 text-center"><BackToSignIn onClick={() => onToggleMode('password')}>{copy.backToSignIn}</BackToSignIn></p>
        </section>
      </AuthPage>
    );
  }

  if (mode === 'reset') {
    return (
      <AuthPage>
        <section className={AUTH_PANEL_CLASS}>
          <AuthHeader title={copy.resetTitle} subtitle={copy.signInSubtitle} />
          <form onSubmit={handleReset} className="space-y-4" noValidate><AuthMessages error={error} message={message} /><div className="space-y-2"><Label htmlFor="reset-email" className="text-sm font-medium">{copy.email}</Label><Input id="reset-email" type="email" autoComplete="email" value={form.email} onChange={(event) => update('email', event.target.value)} placeholder={copy.emailPlaceholder} className={INPUT_CLASS} required /></div><Button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : copy.sendResetLink}</Button></form>
          <p className="mt-6 text-center"><BackToSignIn onClick={() => onToggleMode('password')}>{copy.backToSignIn}</BackToSignIn></p>
        </section>
      </AuthPage>
    );
  }

  if (mode === 'verify') {
    return (
      <AuthPage>
        <section className={AUTH_PANEL_CLASS}>
          <AuthHeader title={copy.verifyTitle} subtitle={copy.verifyDescription} />
          <form onSubmit={handleResendVerification} className="space-y-4" noValidate>
            <AuthMessages error={error} message={message} />
            <div className="space-y-2"><Label htmlFor="verification-email" className="text-sm font-medium">{copy.email}</Label><Input id="verification-email" type="email" autoComplete="email" value={form.email} onChange={(event) => update('email', event.target.value)} placeholder={copy.emailPlaceholder} className={INPUT_CLASS} required /></div>
            <div className="space-y-2"><Label htmlFor="signup-verification-code" className="text-sm font-medium">{copy.confirmationCode}</Label><Input id="signup-verification-code" autoComplete="one-time-code" inputMode="numeric" value={form.code} onChange={(event) => update('code', event.target.value)} placeholder="123456" className={`${INPUT_CLASS} font-mono tracking-[0.18em]`} required /></div>
            <Button type="button" className={PRIMARY_BUTTON_CLASS} disabled={loading || !form.email || !form.code} onClick={() => onVerifySignupCode(form.email, form.code)}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : copy.verifyEmail}</Button>
            <Button type="submit" variant="outline" className="w-full text-foreground dark:text-white hover:!bg-zinc-100 hover:!text-foreground hover:!border-zinc-300 dark:hover:!bg-zinc-800 dark:hover:!text-white" disabled={loading || signupResendSeconds > 0}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : signupResendSeconds > 0 ? copy.resendIn(signupResendSeconds) : copy.resendConfirmation}</Button>
          </form>
          <p className="mt-6 text-center"><BackToSignIn onClick={onSignOut}>{copy.useAnotherEmail}</BackToSignIn></p>
        </section>
      </AuthPage>
    );
  }

  if (mode === 'update-password') {
    return (
      <AuthPage>
        <section className={AUTH_PANEL_CLASS}>
          <AuthHeader title={copy.updateTitle} subtitle={copy.welcome} />
          <form onSubmit={handleUpdatePassword} className="space-y-4" noValidate><AuthMessages error={error} message={message} /><PasswordInput id="new-password" label={copy.newPassword} value={form.password} onChange={(value) => update('password', value)} autoComplete="new-password" visible={showPassword} onToggle={() => setShowPassword((current) => !current)} /><PasswordInput id="confirm-new-password" label={copy.confirmPassword} value={form.confirmPassword} onChange={(value) => update('confirmPassword', value)} autoComplete="new-password" visible={showConfirmPassword} onToggle={() => setShowConfirmPassword((current) => !current)} /><Button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : copy.updatePassword}</Button></form>
        </section>
      </AuthPage>
    );
  }

  return (
    <AuthPage>
      <section className={AUTH_PANEL_CLASS}>
        <AuthHeader title={copy.signInTitle} subtitle={copy.signInSubtitle} />
        <form onSubmit={handleLoginSubmit} className="space-y-4" noValidate>
          <AuthMessages error={error} message={message} />
          <div className="space-y-2"><Label htmlFor="email" className="text-sm font-medium">{copy.email}</Label><Input id="email" name="email" type="email" autoComplete="email" placeholder={copy.emailPlaceholder} className={INPUT_CLASS} value={form.email} onChange={(event) => update('email', event.target.value)} required /></div>
          <PasswordInput id="password" label={copy.password} value={form.password} onChange={(value) => update('password', value)} autoComplete="current-password" visible={showPassword} onToggle={() => setShowPassword((current) => !current)} />
          <div className="flex justify-end"><button type="button" onClick={() => onToggleMode('reset')} className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:underline underline-offset-4">{copy.forgotPassword}</button></div>
          <Button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : copy.signIn}</Button>
        </form>
        <div className="relative my-6"><Separator /><span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-3 text-xs text-muted-foreground">{copy.or}</span></div>
        <Button variant="outline" className="w-full text-foreground dark:text-white hover:!bg-zinc-100 hover:!text-foreground hover:!border-zinc-300 dark:hover:!bg-zinc-800 dark:hover:!text-white" onClick={onGithubSignIn} disabled={loading}><Github className="h-4 w-4" />{copy.continueGithub}</Button>
        <Button variant="outline" className="mt-3 w-full text-foreground dark:text-white hover:!bg-zinc-100 hover:!text-foreground hover:!border-zinc-300 dark:hover:!bg-zinc-800 dark:hover:!text-white" onClick={() => onToggleMode('signup')}>{copy.createAccount}</Button>
      </section>
    </AuthPage>
  );
}
