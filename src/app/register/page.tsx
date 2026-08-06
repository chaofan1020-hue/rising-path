'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSupabaseConfig } from '@/components/supabase-config-inject';

export default function RegisterPage() {
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

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    if (data.user) {
      // Initialize access code mapping on server
      const session = await supabase.auth.getSession();
      if (session.data.session) {
        await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
      }
    }

    router.replace('/jobs');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-black p-4">
      <Card className="w-full max-w-md border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-none">
        <CardHeader className="space-y-2">
          <p className="text-sm font-medium text-zinc-400">开始使用</p>
          <CardTitle className="text-2xl md:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            注册 Rising Path
          </CardTitle>
          <CardDescription className="text-zinc-500 text-base leading-relaxed">
            创建账号，开启你的海外求职之旅。
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
                placeholder="至少 6 位"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="h-11 rounded-xl border-zinc-200 dark:border-zinc-800 focus-visible:ring-zinc-900"
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button
              type="submit"
              disabled={loading || !ready}
              className="w-full h-11 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white"
            >
              {loading ? '注册中...' : '注册'}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-zinc-500">
            已有账号？{' '}
            <Link href="/login" className="text-zinc-900 dark:text-zinc-100 font-medium hover:underline">
              登录
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
