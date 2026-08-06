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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BarChart, Code, Eye, EyeOff, Loader2, User } from 'lucide-react';

type AuthMode = 'signin' | 'signup' | 'otp' | 'reset';

const Logo = (props: JSX.IntrinsicAttributes & SVGProps<SVGSVGElement>) => (
  <svg fill="currentColor" viewBox="0 0 40 20" width="48" height="24" {...props}>
    <path d="M0 0h29a4 4 0 0 1 0 8H0V0z" />
    <path d="M40 20H11a4 4 0 0 1 0-8h29v8z" />
  </svg>
);

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('designer');

  const [otpSent, setOtpSent] = useState(false);

  useEffect(() => {
    let mounted = true;
    getSupabaseBrowserClient()
      .then((sb) => sb.auth.getSession())
      .then(({ data: { session } }) => {
        if (mounted && session) router.replace('/home');
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [router]);

  const resetMessages = () => {
    setError(null);
    setMessage(null);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    setLoading(true);
    try {
      const sb = await getSupabaseBrowserClient();
      const { error: signInError } = await sb.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      router.replace('/home');
      return;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
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
      const sb = await getSupabaseBrowserClient();
      const { error: signUpError } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
            username,
            role,
          },
        },
      });
      if (signUpError) throw signUpError;
      setMessage('注册成功，正在进入…');
      router.replace('/home');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '注册失败');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    setLoading(true);
    try {
      const sb = await getSupabaseBrowserClient();
      const { error: otpError } = await sb.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });
      if (otpError) throw otpError;
      setOtpSent(true);
      setMessage('验证码已发送，请查收邮箱');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '验证码发送失败');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    setLoading(true);
    try {
      const sb = await getSupabaseBrowserClient();
      const { error: verifyError } = await sb.auth.verifyOtp({
        email,
        token: otp,
        type: 'email',
      });
      if (verifyError) throw verifyError;
      router.replace('/home');
      return;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '验证码错误');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    setLoading(true);
    try {
      const sb = await getSupabaseBrowserClient();
      const { error: resetError } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login`,
      });
      if (resetError) throw resetError;
      setMessage('重置链接已发送，请查收邮箱');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Card className="border-none pb-0 shadow-lg">
          <CardHeader className="flex flex-col items-center space-y-1.5 pb-4 pt-6">
            <Logo className="h-8 w-16 text-foreground" />
            <div className="flex flex-col items-center space-y-0.5">
              <h2 className="text-2xl font-semibold text-foreground">
                {mode === 'signin' && '欢迎回来'}
                {mode === 'signup' && '创建账号'}
                {mode === 'otp' && '验证码登录'}
                {mode === 'reset' && '重置密码'}
              </h2>
              <p className="text-center text-sm text-muted-foreground">
                {mode === 'signin' && '登录你的 Rising Path 账号'}
                {mode === 'signup' && '创建账号开启你的求职之旅'}
                {mode === 'otp' && '使用邮箱验证码快速登录'}
                {mode === 'reset' && '我们将向你的邮箱发送重置链接'}
              </p>
            </div>
          </CardHeader>

          <CardContent className="space-y-5 px-8">
            {(error || message) && (
              <div
                className={`rounded-md px-3 py-2 text-sm ${
                  error ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'
                }`}
              >
                {error || message}
              </div>
            )}

            {mode === 'signup' ? (
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger
                      id="role"
                      className="[&>span]:flex [&>span]:items-center [&>span]:gap-2 [&>span_svg]:shrink-0"
                    >
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent className="[&_*[role=option]]:ps-2 [&_*[role=option]]:pe-8 [&_*[role=option]>span]:start-auto [&_*[role=option]>span]:end-2 [&_*[role=option]>span]:flex [&_*[role=option]>span]:items-center [&_*[role=option]>span]:gap-2 [&_*[role=option]>span>svg]:shrink-0">
                      <SelectItem value="designer">
                        <User size={16} aria-hidden="true" />
                        <span className="truncate">Product Designer</span>
                      </SelectItem>
                      <SelectItem value="developer">
                        <Code size={16} aria-hidden="true" />
                        <span className="truncate">Developer</span>
                      </SelectItem>
                      <SelectItem value="manager">
                        <BarChart size={16} aria-hidden="true" />
                        <span className="truncate">Product Manager</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First name</Label>
                    <Input
                      id="firstName"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last name</Label>
                    <Input
                      id="lastName"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      className="pr-10"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
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

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="terms"
                    checked={agreed}
                    onCheckedChange={(v) => setAgreed(v === true)}
                  />
                  <label htmlFor="terms" className="text-sm text-muted-foreground">
                    I agree to the{' '}
                    <Link href="#" className="text-primary hover:underline">
                      Terms
                    </Link>{' '}
                    and{' '}
                    <Link href="#" className="text-primary hover:underline">
                      Conditions
                    </Link>
                  </label>
                </div>

                <Button
                  type="submit"
                  className="w-full bg-primary text-primary-foreground"
                  disabled={loading}
                >
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create free account
                </Button>
              </form>
            ) : mode === 'otp' ? (
              <form onSubmit={otpSent ? handleOtpVerify : handleOtpRequest} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="otp-email">Email address</Label>
                  <Input
                    id="otp-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={otpSent}
                  />
                </div>
                {otpSent && (
                  <div className="space-y-2">
                    <Label htmlFor="otp-code">Verification code</Label>
                    <Input
                      id="otp-code"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      placeholder="000000"
                      required
                    />
                  </div>
                )}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {otpSent ? 'Verify and sign in' : 'Send verification code'}
                </Button>
                {otpSent && (
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto w-full p-0 text-xs"
                    onClick={() => {
                      setOtpSent(false);
                      setOtp('');
                      resetMessages();
                    }}
                  >
                    Use another email
                  </Button>
                )}
              </form>
            ) : mode === 'reset' ? (
              <form onSubmit={handleReset} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-email">Email address</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Send reset link
                </Button>
              </form>
            ) : (
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Email address</Label>
                  <Input
                    id="signin-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="signin-password">Password</Label>
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-xs"
                      onClick={() => {
                        setMode('reset');
                        resetMessages();
                      }}
                    >
                      Forgot password?
                    </Button>
                  </div>
                  <div className="relative">
                    <Input
                      id="signin-password"
                      type={showPassword ? 'text' : 'password'}
                      className="pr-10"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
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
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Sign in
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setMode('otp');
                    resetMessages();
                    setOtpSent(false);
                    setOtp('');
                  }}
                >
                  Sign in with code
                </Button>
              </form>
            )}
          </CardContent>

          <CardFooter className="flex justify-center border-t !py-4">
            <p className="text-center text-sm text-muted-foreground">
              {mode === 'signin' ? (
                <>
                  Don&apos;t have an account?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setMode('signup');
                      resetMessages();
                    }}
                    className="text-primary hover:underline"
                  >
                    Sign up
                  </button>
                </>
              ) : mode === 'signup' ? (
                <>
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setMode('signin');
                      resetMessages();
                    }}
                    className="text-primary hover:underline"
                  >
                    Sign in
                  </button>
                </>
              ) : (
                <>
                  Back to{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setMode('signin');
                      resetMessages();
                    }}
                    className="text-primary hover:underline"
                  >
                    Sign in
                  </button>
                </>
              )}
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
