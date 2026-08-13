'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Lock, Loader2 } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

interface AdminAuthGuardProps {
  children: React.ReactNode;
}

export function AdminAuthGuard({ children }: AdminAuthGuardProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  // 以服务端 HttpOnly 会话为准，不能信任 localStorage 中的标记。
  useEffect(() => {
    let cancelled = false;

    const checkSession = async () => {
      try {
        const response = await fetch('/api/admin/password', { cache: 'no-store' });
        const data = await response.json();
        if (!cancelled) setIsAuthenticated(data.authenticated === true);
      } catch {
        if (!cancelled) setIsAuthenticated(false);
      } finally {
        if (!cancelled) setMounted(true);
      }
    };

    void checkSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // 调用API验证密码
      const response = await fetch('/api/admin/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (data.valid) {
        setIsAuthenticated(true);
      } else {
        setError('密码错误，请重试');
      }
    } catch {
      setError('验证失败，请稍后重试');
    }
    
    setLoading(false);
  };

  const handleSupabaseLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const supabase = await getSupabaseBrowserClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError('请先登录平台账号');
        return;
      }
      const response = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await response.json();
      if (response.ok) {
        setIsAuthenticated(true);
      } else {
        setError(data.error?.message || '该账号尚未绑定管理员权限');
      }
    } catch {
      setError('管理员账号登录失败');
    } finally {
      setLoading(false);
    }
  };

  // 避免服务端渲染不一致
  if (!mounted) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Lock className="h-8 w-8 text-primary" />
            </div>
            <CardTitle>管理后台登录</CardTitle>
            <CardDescription>
              请输入已配置的管理密码访问后台
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <input
                type="text"
                name="username"
                autoComplete="username"
                value="admin"
                readOnly
                tabIndex={-1}
                className="sr-only"
                aria-hidden="true"
              />
              <div>
                <Label htmlFor="password">管理密码</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入管理密码"
                  disabled={loading}
                />
              </div>
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={loading || !password}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    验证中...
                  </>
                ) : (
                  '登录'
                )}
              </Button>
              <Button type="button" variant="outline" className="w-full" disabled={loading} onClick={() => void handleSupabaseLogin()}>
                使用已登录的 Supabase 账号
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
