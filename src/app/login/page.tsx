'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CtaCard } from '@/components/ui/cta-card';

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
        localStorage.setItem('access_code', JSON.stringify(data.code));
        router.push('/');
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
    <div className="min-h-screen bg-white dark:bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-6xl">
        <CtaCard
          imageSrc="https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&q=80&w=2000"
          title="欢迎使用 Rising Path"
          description="专为海外留学生打造的一站式求职平台。输入访问码开始您的求职之旅。"
          inputPlaceholder="请输入访问码"
          buttonText="进入平台"
          onButtonClick={(inputCode) => {
            setCode(inputCode);
            // 触发登录
            const form = document.querySelector('form');
            if (form) form.requestSubmit();
          }}
        />
        {error && (
          <div className="mt-4 text-center text-red-500">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
