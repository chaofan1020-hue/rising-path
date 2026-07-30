'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { CtaCard } from '@/components/ui/cta-card';

interface AccessCode {
  id: number;
  code: string;
  name: string;
  expires_at: string;
}

interface AccessCodeContextType {
  accessCode: AccessCode | null;
  accessCodeId: number | null;
  isAuthenticated: boolean;
  logout: () => void;
}

const AccessCodeContext = createContext<AccessCodeContextType | null>(null);

export function useAccessCode() {
  const context = useContext(AccessCodeContext);
  if (!context) {
    // 返回默认值，避免报错
    return {
      accessCode: null,
      accessCodeId: null,
      isAuthenticated: false,
      logout: () => {},
    };
  }
  return context;
}

export function AccessGuard({ children }: { children: ReactNode }) {
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

      // 尝试解析 JSON，如果失败则视为纯字符串访问码
      let codeData: AccessCode;
      try {
        codeData = JSON.parse(stored) as AccessCode;
      } catch {
        // 如果不是 JSON，视为纯字符串访问码
        codeData = { id: 0, code: stored, name: '', expires_at: '' };
      }
      
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
      // 出错时清除可能损坏的数据
      localStorage.removeItem('access_code');
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('access_code');
    setAccessCode(null);
    setAuthorized(false);
    router.push('/login');
  };

  const contextValue: AccessCodeContextType = {
    accessCode,
    accessCodeId: accessCode?.id || null,
    isAuthenticated: authorized,
    logout,
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
      <div className="min-h-screen bg-white dark:bg-black flex items-center justify-center p-4">
        <div className="w-full max-w-6xl">
          <CtaCard
            title="欢迎使用 Rising Path"
            description="输入您的专属访问码，开启智能求职之旅。AI 智能选岗、简历优化、自动网申，助力海外留学生拿到理想 Offer。"
            buttonText="进入平台"
            inputPlaceholder="请输入访问码"
            imageSrc="https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0?ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8M3x8YmFja2dyb3VuZHxlbnwwfHwwfHx8MA%3D%3D&auto=format&fit=crop&q=60&w=900&q=80&w=2574&auto=format&fit=crop"
            onButtonClick={async (code) => {
              if (!code.trim()) return;
              try {
                const response = await fetch('/api/access-codes/verify', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ code: code.trim() }),
                });
                const data = await response.json();
                if (response.ok && data.valid) {
                  localStorage.setItem('access_code', JSON.stringify(data.code));
                  localStorage.setItem('access_code_id', String(data.access_code_id));
                  window.location.reload();
                }
              } catch (err) {
                console.error('Access code verification failed:', err);
              }
            }}
            className="min-h-[200px] md:min-h-[250px]"
          />
        </div>
      </div>
    );
  }

  return (
    <AccessCodeContext.Provider value={contextValue}>
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
            onClick={logout}
            className="h-7 text-xs"
          >
            退出登录
          </Button>
        </div>
      </div>
      {children}
    </AccessCodeContext.Provider>
  );
}
