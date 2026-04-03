'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Briefcase, Key, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setError('请输入访问码');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/access-codes/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.toUpperCase() }),
      });

      const data = await response.json();

      if (data.valid) {
        // 保存访问码到 localStorage
        localStorage.setItem('access_code', JSON.stringify(data.code));
        router.push('/jobs');
      } else {
        setError(data.error || '访问码无效');
      }
    } catch (err) {
      setError('验证失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/20 to-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-4">
            <Briefcase className="h-10 w-10 text-primary" />
            <span className="font-bold text-3xl">PathUp</span>
          </Link>
          <p className="text-muted-foreground">海外留学生求职平台</p>
        </div>

        {/* Login Card */}
        <Card className="border-0 shadow-xl">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Key className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-xl">输入访问码</CardTitle>
            <CardDescription>
              请输入管理员提供的访问码以使用平台功能
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code">访问码</Label>
                <Input
                  id="code"
                  type="text"
                  placeholder="请输入8位访问码"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.toUpperCase());
                    setError('');
                  }}
                  className="text-center text-lg tracking-widest font-mono"
                  maxLength={8}
                  disabled={loading}
                />
                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}
              </div>
              <Button 
                type="submit" 
                className="w-full" 
                disabled={loading || code.length < 4}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    验证中...
                  </>
                ) : (
                  '验证并进入'
                )}
              </Button>
            </form>

            <div className="mt-6 pt-6 border-t text-center text-sm text-muted-foreground">
              <p>没有访问码？</p>
              <p className="mt-1">请联系管理员获取</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
