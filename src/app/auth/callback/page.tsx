'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const finish = async () => {
      try {
        const supabase = await getSupabaseBrowserClient();
        const searchParams = new URLSearchParams(window.location.search);
        const code = searchParams.get('code');
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else {
          const { error: sessionError } = await supabase.auth.getSession();
          if (sessionError) throw sessionError;
        }
        const next = searchParams.get('next');
        const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/home';
        if (mounted) router.replace(safeNext);
      } catch (callbackError) {
        if (mounted) setError(callbackError instanceof Error ? callbackError.message : '验证链接无效或已过期');
      }
    };
    void finish();
    return () => {
      mounted = false;
    };
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center space-y-3">
        {error ? (
          <>
            <p className="text-sm text-destructive">{error}</p>
            <button className="text-sm underline" onClick={() => router.replace('/login')}>
              返回登录
            </button>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-6 w-6 animate-spin" />
            <p className="text-sm text-muted-foreground">正在完成验证...</p>
          </>
        )}
      </div>
    </main>
  );
}
