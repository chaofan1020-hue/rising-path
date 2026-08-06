'use client';

import { useEffect, useState, type SVGProps, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

type AuthMode = 'signin' | 'signup' | 'otp' | 'reset';

const Logo = (props: JSX.IntrinsicAttributes & SVGProps<SVGSVGElement>) => (
  <svg fill="currentColor" viewBox="0 0 40 20" width="48" height="24" {...props}>
    <path d="M0 0h29a4 4 0 0 1 0 8H0V0z" />
    <path d="M40 20H11a4 4 0 0 1 0-8h29v8z" />
  </svg>
);

export default function LoginPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    getSupabaseBrowserClient()
      .then((supabase) => supabase.auth.getSession())
      .then(({ data: { session } }) => {
        if (session) {
          router.replace('/home');
        }
      })
      .catch(() => {});
  }, [router]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const supabase = await getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;
      router.replace('/home');
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    if (!agreed) {
      setError('请同意服务条款');
      return;
    }
    setLoading(true);
    try {
      const supabase = await getSupabaseBrowserClient();
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });
      if (signUpError) throw signUpError;
      setMessage('注册成功，正在进入…');
      router.replace('/home');
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const supabase = await getSupabaseBrowserClient();
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
        },
      });
      if (otpError) throw otpError;
      setOtpSent(true);
      setMessage('验证码已发送到邮箱');
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送验证码失败');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
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
      setError(err instanceof Error ? err.message : '验证码错误');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const supabase = await getSupabaseBrowserClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email,
        {
          redirectTo: `${window.location.origin}/login`,
        }
      );
      if (resetError) throw resetError;
      setMessage('重置链接已发送，请检查邮箱');
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setLoading(false);
    }
  };

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const ModeToggle = ({
    label,
    target,
  }: {
    label: string;
    target: AuthMode;
  }) => (
    <button
      type="button"
      onClick={() => {
        setMode(target);
        setError(null);
        setMessage(null);
      }}
      className="text-sm font-medium text-primary hover:underline"
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-md">
        <Card className="border-none shadow-lg">
          <CardHeader className="flex flex-col items-center space-y-3 pb-4 pt-8">
            <Logo className="text-foreground" />
            <div className="space-y-1 text-center">
              <h2 className="text-2xl font-semibold text-foreground">
                {mode === 'signin' && '欢迎回来'}
                {mode === 'signup' && '创建账号'}
                {mode === 'otp' && '邮箱验证码登录'}
                {mode === 'reset' && '重置密码'}
              </h2>
              <p className="text-sm text-muted-foreground">
                {mode === 'signin' && '登录你的 Rising Path 账号'}
                {mode === 'signup' && '注册后即可开始你的求职之旅'}
                {mode === 'otp' && '输入邮箱接收一次性验证码'}
                {mode === 'reset' && '我们将向你的邮箱发送重置链接'}
              </p>
            </div>
          </CardHeader>

          <CardContent className="space-y-5 px-8">
            {(error || message) && (
              <div
                className={`rounded-lg px-4 py-3 text-sm ${
                  error
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-primary/10 text-primary'
                }`}
              >
                {error || message}
              </div>
            )}

            {(mode === 'signin' || mode === 'signup') && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant={mode === 'signin' ? 'default' : 'outline'}
                    className="w-full"
                    onClick={() => {
                      setMode('signin');
                      setError(null);
                      setMessage(null);
                    }}
                  >
                    登录
                  </Button>
                  <Button
                    type="button"
                    variant={mode === 'signup' ? 'default' : 'outline'}
                    className="w-full"
                    onClick={() => {
                      setMode('signup');
                      setError(null);
                      setMessage(null);
                    }}
                  >
                    注册
                  </Button>
                </div>

                <form
                  onSubmit={mode === 'signin' ? handleSignIn : handleSignUp}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="email">邮箱</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">密码</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={6}
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3 text-muted-foreground hover:bg-transparent"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {mode === 'signup' && (
                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword">确认密码</Label>
                      <Input
                        id="confirmPassword"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        minLength={6}
                      />
                    </div>
                  )}

                  {mode === 'signup' && (
                    <div className="flex items-start space-x-2">
                      <Checkbox
                        id="terms"
                        checked={agreed}
                        onCheckedChange={(v) => setAgreed(v === true)}
                      />
                      <label
                        htmlFor="terms"
                        className="text-sm leading-tight text-muted-foreground"
                      >
                        我同意
                        <Link
                          href="#"
                          className="text-primary hover:underline"
                        >
                          服务条款
                        </Link>
                        和
                        <Link
                          href="#"
                          className="text-primary hover:underline"
                        >
                          隐私政策
                        </Link>
                      </label>
                    </div>
                  )}

                  {mode === 'signin' && (
                    <div className="flex items-center justify-end">
                      <ModeToggle label="忘记密码？" target="reset" />
                    </div>
                  )}

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {mode === 'signin' ? '登录' : '创建账号'}
                  </Button>
                </form>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <Separator className="w-full" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">
                      其他方式
                    </span>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setMode('otp');
                    setOtpSent(false);
                    setOtp('');
                    setError(null);
                    setMessage(null);
                  }}
                >
                  邮箱验证码登录
                </Button>
              </>
            )}

            {mode === 'otp' && (
              <form onSubmit={otpSent ? handleVerifyOtp : handleSendOtp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="otp-email">邮箱</Label>
                  <Input
                    id="otp-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={otpSent}
                    required
                  />
                </div>

                {otpSent && (
                  <div className="space-y-2">
                    <Label htmlFor="otp">验证码</Label>
                    <Input
                      id="otp"
                      type="text"
                      placeholder="123456"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      required
                    />
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {otpSent ? '验证并登录' : '发送验证码'}
                </Button>

                <div className="flex justify-between">
                  <ModeToggle label="返回密码登录" target="signin" />
                  {otpSent && (
                    <button
                      type="button"
                      onClick={handleSendOtp}
                      disabled={loading}
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      重新发送
                    </button>
                  )}
                </div>
              </form>
            )}

            {mode === 'reset' && (
              <form onSubmit={handleReset} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-email">邮箱</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  发送重置链接
                </Button>
                <div className="text-center">
                  <ModeToggle label="返回登录" target="signin" />
                </div>
              </form>
            )}
          </CardContent>

          <CardFooter className="flex justify-center border-t py-4">
            <p className="text-center text-sm text-muted-foreground">
              {mode === 'signin' ? (
                <>
                  还没有账号？ <ModeToggle label="立即注册" target="signup" />
                </>
              ) : mode === 'signup' ? (
                <>
                  已有账号？ <ModeToggle label="立即登录" target="signin" />
                </>
              ) : null}
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
