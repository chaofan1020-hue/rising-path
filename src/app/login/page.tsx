'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSupabaseConfig } from '@/components/supabase-config-inject';

export default function LoginPage() {
  const router = useRouter();
  const { supabase, ready } = useSupabaseConfig();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || !supabase) return;
    setLoading(true);
    setError('');

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    router.replace('/jobs');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-black p-4">
      <Card className="w-full max-w-md border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-none">
        <CardHeader className="space-y-2">
          <p className="text-sm font-medium text-zinc-400">欢迎回来</p>
          <CardTitle className="text-2xl md:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            登录 Rising Path
          </CardTitle>
          <CardDescription className="text-zinc-500 text-base leading-relaxed">
            使用邮箱和密码继续访问你的求职工作台。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-zinc-700 dark:text-zinc-300">
                邮箱
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11 rounded-xl border-zinc-200 dark:border-zinc-800 focus-visible:ring-zinc-900"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-zinc-700 dark:text-zinc-300">
                密码
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="你的密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-11 rounded-xl border-zinc-200 dark:border-zinc-800 focus-visible:ring-zinc-900"
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button
              type="submit"
              disabled={loading || !ready}
              className="w-full h-11 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white"
            >
              {loading ? '登录中...' : '登录'}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-zinc-500">
            还没有账号？{' '}
            <Link href="/register" className="text-zinc-900 dark:text-zinc-100 font-medium hover:underline">
              注册
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
