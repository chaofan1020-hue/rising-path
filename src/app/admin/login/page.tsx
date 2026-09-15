'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HumanVerification } from '@/components/human-verification';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'otp' | 'password'>('otp');
  const [passwordLoginAllowed, setPasswordLoginAllowed] = useState(false);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaEnabled, setCaptchaEnabled] = useState(false);
  const [captchaReady, setCaptchaReady] = useState(false);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/admin/auth', { cache: 'no-store' })
      .then((response) => response.json())
      .then((auth) => {
        if (cancelled) return;
        if (auth.authenticated) {
          router.replace('/admin');
          return;
        }
        setPasswordLoginAllowed(Boolean(auth.passwordLoginAllowed));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const sendCode = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/auth/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, captchaToken }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '验证码发送失败');
      setStep('code');
      setMessage(data.message || '如果该邮箱已绑定管理员，将收到验证码');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '验证码发送失败');
      setCaptchaToken(null);
      setCaptchaKey((value) => value + 1);
    } finally {
      setLoading(false);
    }
  };

  const loginWithPassword = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '登录失败');
      router.replace('/admin');
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token: code }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '验证失败');
      router.replace('/admin');
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '验证失败');
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4 dark:bg-zinc-950">
      <Card className="w-full max-w-md border-zinc-200 shadow-sm dark:border-zinc-800">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <CardTitle>运营后台登录</CardTitle>
          <CardDescription>
            {passwordLoginAllowed
              ? '尚未绑定超级管理员时，可先用启动密码进入，再在「管理员」里绑定邮箱。'
              : '使用已绑定的管理员邮箱收取验证码。'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {passwordLoginAllowed && (
            <div className="mb-4 flex rounded-lg border border-zinc-200 p-1 dark:border-zinc-800">
              <button type="button" className={`flex-1 rounded-md px-3 py-1.5 text-sm ${mode === 'otp' ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-600'}`} onClick={() => { setMode('otp'); setError(''); }}>邮箱验证码</button>
              <button type="button" className={`flex-1 rounded-md px-3 py-1.5 text-sm ${mode === 'password' ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-600'}`} onClick={() => { setMode('password'); setError(''); }}>启动密码</button>
            </div>
          )}
          {mode === 'password' && passwordLoginAllowed ? (
            <form onSubmit={(event) => void loginWithPassword(event)} className="space-y-4">
              <div>
                <Label htmlFor="admin-password">启动密码</Label>
                <Input
                  id="admin-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={loading}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full bg-zinc-900 text-white hover:bg-zinc-800" disabled={loading || !password}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                进入后台
              </Button>
              <p className="text-xs text-muted-foreground">绑定至少一名超级管理员后，启动密码会自动关闭。</p>
            </form>
          ) : step === 'email' ? (
            <form onSubmit={(event) => void sendCode(event)} className="space-y-4">
              <div>
                <Label htmlFor="admin-email">管理员邮箱</Label>
                <Input
                  id="admin-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="admin@company.com"
                  disabled={loading}
                  required
                />
              </div>
              <HumanVerification
                key={captchaKey}
                language="zh-CN"
                onToken={setCaptchaToken}
                onEnabled={(enabled) => {
                  setCaptchaEnabled(enabled);
                  setCaptchaReady(true);
                }}
                resetSignal={captchaKey}
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full bg-zinc-900 text-white hover:bg-zinc-800" disabled={loading || !email || !captchaReady || (captchaEnabled && !captchaToken)}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                发送验证码
              </Button>
            </form>
          ) : (
            <form onSubmit={(event) => void verifyCode(event)} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                6 位数字验证码已发往 {email}。请填邮件里的验证码，不要点注册确认链接。
              </p>
              <div>
                <Label htmlFor="admin-code">邮箱验证码</Label>
                <Input
                  id="admin-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\s/g, ''))}
                  placeholder="6 位数字"
                  disabled={loading}
                  required
                />
              </div>
              {message && <p className="text-sm text-muted-foreground">{message}</p>}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full bg-zinc-900 text-white hover:bg-zinc-800" disabled={loading || !code}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                登录
              </Button>
              <Button type="button" variant="ghost" className="w-full" disabled={loading} onClick={() => { setStep('email'); setCode(''); setError(''); }}>
                使用其他邮箱
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
