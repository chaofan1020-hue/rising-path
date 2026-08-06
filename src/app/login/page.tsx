'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<'password' | 'otp'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    getSupabaseBrowserClient()
      .then((client) => client.auth.getSession())
      .then(({ data: { session } }) => {
        if (session) {
          router.replace('/home');
        }
      })
      .catch(() => {});
  }, [router]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const client = await getSupabaseBrowserClient();
      const { error: signInError } = await client.auth.signInWithPassword({
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

  const handlePasswordSignUp = async () => {
    setLoading(true);
    setError(null);
    try {
      const client = await getSupabaseBrowserClient();
      const { error: signUpError } = await client.auth.signUp({
        email,
        password,
      });
      if (signUpError) throw signUpError;
      router.replace('/home');
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败');
    } finally {
      setLoading(false);
    }
  };

  const sendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const client = await getSupabaseBrowserClient();
      const { error: otpError } = await client.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
        },
      });
      if (otpError) throw otpError;
      setOtpSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码发送失败');
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const client = await getSupabaseBrowserClient();
      const { error: verifyError } = await client.auth.verifyOtp({
        email,
        token: otp,
        type: 'email',
      });
      if (verifyError) throw verifyError;
      router.replace('/home');
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码校验失败');
    } finally {
      setLoading(false);
    }
  };

  if (!mounted) {
    return null;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F5F0EB] px-4">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            欢迎加入 Rising Path
          </h1>
          <p className="text-sm text-zinc-500">
            使用邮箱注册或登录你的账号
          </p>
        </div>

        <Tabs
          value={mode}
          onValueChange={(v) => setMode(v as 'password' | 'otp')}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-2 bg-zinc-100">
            <TabsTrigger value="password" className="text-sm">
              密码
            </TabsTrigger>
            <TabsTrigger value="otp" className="text-sm">
              邮箱验证码
            </TabsTrigger>
          </TabsList>

          <TabsContent value="password">
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email-pwd" className="text-zinc-700">
                  邮箱
                </Label>
                <Input
                  id="email-pwd"
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-zinc-700">
                  密码
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="至少 6 位"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400"
                />
              </div>

              {error && (
                <p className="text-sm text-red-500">{error}</p>
              )}

              <Button
                type="submit"
                disabled={loading || !email || password.length < 6}
                className="w-full bg-zinc-900 text-white hover:bg-zinc-800"
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                登录
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={loading || !email || password.length < 6}
                onClick={handlePasswordSignUp}
                className="w-full border-zinc-200 text-zinc-900 hover:bg-zinc-100"
              >
                注册账号
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="otp">
            {!otpSent ? (
              <form onSubmit={sendOtp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email-otp" className="text-zinc-700">
                    邮箱
                  </Label>
                  <Input
                    id="email-otp"
                    type="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400"
                  />
                </div>
                {error && <p className="text-sm text-red-500">{error}</p>}
                <Button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full bg-zinc-900 text-white hover:bg-zinc-800"
                >
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  发送验证码
                </Button>
              </form>
            ) : (
              <form onSubmit={verifyOtp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="otp" className="text-zinc-700">
                    验证码
                  </Label>
                  <Input
                    id="otp"
                    type="text"
                    inputMode="numeric"
                    placeholder="6 位验证码"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    required
                    maxLength={6}
                    className="border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400"
                  />
                  <p className="text-xs text-zinc-500">
                    验证码已发送至 {email}
                  </p>
                </div>
                {error && <p className="text-sm text-red-500">{error}</p>}
                <Button
                  type="submit"
                  disabled={loading || otp.length < 6}
                  className="w-full bg-zinc-900 text-white hover:bg-zinc-800"
                >
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  验证并登录
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-zinc-500 hover:text-zinc-900"
                  onClick={() => {
                    setOtpSent(false);
                    setOtp('');
                    setError(null);
                  }}
                >
                  重新发送
                </Button>
              </form>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
