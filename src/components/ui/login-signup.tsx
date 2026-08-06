'use client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { BarChart, Code, Eye, EyeOff, Loader2, User } from 'lucide-react';
import Link from 'next/link';
import { JSX, SVGProps, useState } from 'react';

const Logo = (props: JSX.IntrinsicAttributes & SVGProps<SVGSVGElement>) => (
  <svg
    fill="currentColor"
    height="48"
    viewBox="0 0 40 48"
    width="40"
    {...props}
  >
    <clipPath id="a">
      <path d="m0 0h40v48h-40z" />
    </clipPath>
    <g clipPath="url(#a)">
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
  firstName: string;
  lastName: string;
  username: string;
  role: string;
}

interface LoginSignupProps {
  mode: 'login' | 'signup' | 'otp' | 'reset';
  onToggleMode: (mode: 'login' | 'signup' | 'otp' | 'reset') => void;
  onLogin: (email: string, password: string) => void | Promise<void>;
  onRegister: (data: RegisterData) => void | Promise<void>;
  onSendCode: (email: string) => void | Promise<void>;
  onVerifyCode: (email: string, code: string) => void | Promise<void>;
  onResetPassword: (email: string) => void | Promise<void>;
  loading?: boolean;
  error?: string | null;
  message?: string | null;
}

export default function LoginSignup({
  mode,
  onToggleMode,
  onLogin,
  onRegister,
  onSendCode,
  onVerifyCode,
  onResetPassword,
  loading,
  error,
  message,
}: LoginSignupProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [form, setForm] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    code: '',
    firstName: '',
    lastName: '',
    username: '',
    role: 'designer',
    terms: false,
  });

  const update = (key: keyof typeof form, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onLogin(form.email, form.password);
  };

  const handleRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onRegister({
      email: form.email,
      password: form.password,
      firstName: form.firstName,
      lastName: form.lastName,
      username: form.username,
      role: form.role,
    });
  };

  const handleSendCode = () => {
    onSendCode(form.email);
  };

  const handleVerifyCode = (e: React.FormEvent) => {
    e.preventDefault();
    onVerifyCode(form.email, form.code);
  };

  const handleReset = (e: React.FormEvent) => {
    e.preventDefault();
    onResetPassword(form.email);
  };

  if (mode === 'signup') {
    return (
      <div className="flex items-center justify-center min-h-screen px-4 py-10">
        <div className="w-full max-w-md">
          <Card className="border-none shadow-lg pb-0">
            <CardHeader className="flex flex-col items-center space-y-1.5 pb-4 pt-6">
              <Logo className="w-12 h-12" />
              <div className="space-y-0.5 flex flex-col items-center">
                <h2 className="text-2xl font-semibold text-foreground">
                  Create an account
                </h2>
                <p className="text-muted-foreground">
                  Welcome! Create an account to get started.
                </p>
              </div>
            </CardHeader>
            <form onSubmit={handleRegisterSubmit}>
              <CardContent className="space-y-5 px-8">
                {error && (
                  <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-md">
                    {error}
                  </div>
                )}
                {message && (
                  <div className="text-sm text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 rounded-md">
                    {message}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <Select
                    value={form.role}
                    onValueChange={(v) => update('role', v)}
                  >
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
                      value={form.firstName}
                      onChange={(e) => update('firstName', e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last name</Label>
                    <Input
                      id="lastName"
                      value={form.lastName}
                      onChange={(e) => update('lastName', e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    value={form.username}
                    onChange={(e) => update('username', e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => update('email', e.target.value)}
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
                      value={form.password}
                      onChange={(e) => update('password', e.target.value)}
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
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      className="pr-10"
                      value={form.confirmPassword}
                      onChange={(e) =>
                        update('confirmPassword', e.target.value)
                      }
                      required
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3 text-muted-foreground hover:bg-transparent"
                      onClick={() =>
                        setShowConfirmPassword(!showConfirmPassword)
                      }
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="terms"
                    checked={form.terms}
                    onCheckedChange={(v) => update('terms', Boolean(v))}
                    required
                  />
                  <label
                    htmlFor="terms"
                    className="text-sm text-muted-foreground"
                  >
                    I agree to the{' '}
                    <Link href="#" className="text-zinc-900 hover:text-zinc-700 dark:text-zinc-100 dark:hover:text-zinc-300 underline underline-offset-4">
                      Terms
                    </Link>{' '}
                    and{' '}
                    <Link href="#" className="text-zinc-900 hover:text-zinc-700 dark:text-zinc-100 dark:hover:text-zinc-300 underline underline-offset-4">
                      Conditions
                    </Link>
                  </label>
                </div>
                <Button
                  type="submit"
                  className="w-full bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                  disabled={loading || !form.terms}
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Create free account'
                  )}
                </Button>
              </CardContent>
            </form>
            <CardFooter className="flex justify-center border-t !py-4">
              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => onToggleMode('login')}
                  className="text-zinc-900 hover:text-zinc-700 dark:text-zinc-100 dark:hover:text-zinc-300 underline underline-offset-4"
                >
                  Sign in
                </button>
              </p>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  if (mode === 'otp') {
    return (
      <div className="flex items-center justify-center min-h-screen px-4 py-10">
        <div className="sm:mx-auto sm:w-full sm:max-w-sm">
          <h2 className="text-center text-xl font-semibold text-foreground">
            Sign in with email code
          </h2>
          <form onSubmit={handleVerifyCode} className="mt-6 space-y-4">
            {error && (
              <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-md">
                {error}
              </div>
            )}
            <div>
              <Label htmlFor="otp-email" className="font-medium text-foreground">
                Email
              </Label>
              <Input
                id="otp-email"
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                placeholder="john@company.com"
                className="mt-2"
                required
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleSendCode}
              disabled={loading || !form.email}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Send code'
              )}
            </Button>
            <div>
              <Label htmlFor="code" className="font-medium text-foreground">
                Verification code
              </Label>
              <Input
                id="code"
                value={form.code}
                onChange={(e) => update('code', e.target.value)}
                placeholder="123456"
                className="mt-2"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Verify code'
              )}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              <button
                type="button"
                onClick={() => onToggleMode('login')}
                className="text-zinc-900 hover:text-zinc-700 dark:text-zinc-100 dark:hover:text-zinc-300 underline underline-offset-4"
              >
                Back to password sign in
              </button>
            </p>
          </form>
        </div>
      </div>
    );
  }

  if (mode === 'reset') {
    return (
      <div className="flex items-center justify-center min-h-screen px-4 py-10">
        <div className="sm:mx-auto sm:w-full sm:max-w-sm">
          <h2 className="text-center text-xl font-semibold text-foreground">
            Reset your password
          </h2>
          <form onSubmit={handleReset} className="mt-6 space-y-4">
            {error && (
              <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-md">
                {error}
              </div>
            )}
            <div>
              <Label htmlFor="reset-email" className="font-medium text-foreground">
                Email
              </Label>
              <Input
                id="reset-email"
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                placeholder="john@company.com"
                className="mt-2"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Send reset link'
              )}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              <button
                type="button"
                onClick={() => onToggleMode('login')}
                className="text-zinc-900 hover:text-zinc-700 dark:text-zinc-100 dark:hover:text-zinc-300 underline underline-offset-4"
              >
                Back to sign in
              </button>
            </p>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-zinc-50 px-4 py-10">
      <div className="flex flex-1 flex-col justify-center rounded-xl border border-zinc-200 bg-white p-6 shadow-sm sm:mx-auto sm:w-full sm:max-w-sm">
        <h2 className="text-center text-xl font-semibold text-foreground">
          Log in or create account
        </h2>
        <form onSubmit={handleLoginSubmit} className="mt-6">
          {error && (
            <div className="mb-4 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-md">
              {error}
            </div>
          )}
          {message && (
            <div className="mb-4 text-sm text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 rounded-md">
              {message}
            </div>
          )}
          <Label htmlFor="email" className="font-medium text-foreground">
            Email
          </Label>
          <Input
            type="email"
            id="email"
            name="email"
            autoComplete="email"
            placeholder="john@company.com"
            className="mt-2"
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
            required
          />
          <div className="mt-4">
            <Label htmlFor="password" className="font-medium text-foreground">
              Password
            </Label>
            <div className="relative mt-2">
              <Input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
                className="pr-10"
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
          <div className="mt-2 text-right">
            <button
              type="button"
              onClick={() => onToggleMode('reset')}
              className="text-sm text-zinc-600 hover:text-zinc-900 hover:underline"
            >
              Forgot password?
            </button>
          </div>
          <Button type="submit" className="mt-4 w-full bg-zinc-900 text-white hover:bg-zinc-800" disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Sign in'
            )}
          </Button>
        </form>
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <Separator className="w-full" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              or
            </span>
          </div>
        </div>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => onToggleMode('otp')}
        >
          Sign in with email code
        </Button>
        <Button
          variant="outline"
          className="w-full mt-3"
          onClick={() => onToggleMode('signup')}
        >
          Create account
        </Button>
        <p className="mt-4 text-xs text-center text-muted-foreground">
          By signing in, you agree to our{' '}
          <Link href="#" className="underline underline-offset-4">
            terms of service
          </Link>{' '}
          and{' '}
          <Link href="#" className="underline underline-offset-4">
            privacy policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
