'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Briefcase, Loader2 } from 'lucide-react';
import Link from 'next/link';

interface AccessCode {
  id: number;
  code: string;
  name: string;
  expires_at: string;
}

export function AccessGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [accessCode, setAccessCode] = useState<AccessCode | null>(null);

  useEffect(() => {
    checkAccess();
  }, []);

  const checkAccess = async () => {
    try {
      // 从 localStorage 获取访问码
      const stored = localStorage.getItem('access_code');
      if (!stored) {
        setLoading(false);
        return;
      }

      const codeData = JSON.parse(stored) as AccessCode;
      
      // 验证访问码是否仍然有效
      const response = await fetch('/api/access-codes/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: codeData.code }),
      });

      const data = await response.json();

      if (data.valid) {
        setAccessCode(data.code);
        setAuthorized(true);
        // 更新 localStorage 中的数据
        localStorage.setItem('access_code', JSON.stringify(data.code));
      } else {
        // 访问码无效，清除存储
        localStorage.removeItem('access_code');
      }
    } catch (error) {
      console.error('Access check failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('access_code');
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">验证访问权限...</p>
        </div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mx-auto mb-6">
            <Briefcase className="h-10 w-10 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold mb-2">需要访问权限</h1>
          <p className="text-muted-foreground mb-6">
            请先输入有效的访问码以使用平台功能
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button onClick={() => router.push('/login')}>
              输入访问码
            </Button>
            <Button variant="outline" asChild>
              <Link href="/">返回首页</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* 顶部提示栏 */}
      <div className="bg-primary/5 border-b py-1.5 px-4">
        <div className="container mx-auto flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span>访问码:</span>
            <code className="bg-background px-2 py-0.5 rounded font-mono text-xs">
              {accessCode?.code}
            </code>
            <span className="hidden sm:inline">|</span>
            <span className="hidden sm:inline">
              有效期至: {new Date(accessCode?.expires_at || '').toLocaleDateString('zh-CN')}
            </span>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleLogout}
            className="h-7 text-xs"
          >
            退出登录
          </Button>
        </div>
      </div>
      {children}
    </>
  );
}
