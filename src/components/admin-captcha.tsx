'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, RefreshCw, Shield } from 'lucide-react';
import {
  isAdminCaptchaChallenge,
  solveAdminCaptcha,
  type AdminCaptchaSolution,
} from '@/lib/admin-captcha-core';

export function AdminCaptcha({
  onToken,
}: {
  onToken: (token: AdminCaptchaSolution | null) => void;
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const onTokenRef = useRef(onToken);
  const generationRef = useRef(0);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  const run = useCallback(async () => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setStatus('loading');
    setError('');
    onTokenRef.current(null);
    try {
      const response = await fetch('/api/admin/auth/challenge', { cache: 'no-store' });
      const data = await response.json() as { challenge?: unknown; error?: string };
      if (!response.ok) throw new Error(data.error || '安全验证失败');
      if (!isAdminCaptchaChallenge(data.challenge)) throw new Error('安全验证数据无效');
      const solution = await solveAdminCaptcha(data.challenge);
      if (generationRef.current !== generation) return;
      onTokenRef.current(solution);
      setStatus('ready');
    } catch (reason) {
      if (generationRef.current !== generation) return;
      onTokenRef.current(null);
      setStatus('error');
      setError(reason instanceof Error ? reason.message : '安全验证失败');
    }
  }, []);

  useEffect(() => {
    void run();
    return () => {
      generationRef.current += 1;
      onTokenRef.current(null);
    };
  }, [run]);

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
          {status === 'ready' ? <Check className="h-4 w-4 text-emerald-600" /> : status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">安全验证</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {status === 'ready' ? '已通过，本地计算，不经过第三方' : status === 'loading' ? '正在完成人机验证…' : error || '验证失败，请重试'}
          </p>
        </div>
      </div>
      {status === 'error' && (
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-medium text-zinc-700 hover:underline dark:text-zinc-300"
          onClick={() => void run()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          重试
        </button>
      )}
    </div>
  );
}
