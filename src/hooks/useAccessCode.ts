'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface AccessCode {
  id: number;
  code: string;
  name: string;
  expires_at: string;
}

export function useAccessCode() {
  const router = useRouter();
  const [accessCode, setAccessCode] = useState<AccessCode | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 从 localStorage 获取访问码
    const stored = localStorage.getItem('access_code');
    if (stored) {
      try {
        const codeData = JSON.parse(stored) as AccessCode;
        setAccessCode(codeData);
      } catch (e) {
        console.error('Failed to parse access code:', e);
        localStorage.removeItem('access_code');
      }
    }
    setLoading(false);
  }, []);

  const logout = () => {
    localStorage.removeItem('access_code');
    setAccessCode(null);
    router.push('/login');
  };

  const isAuthenticated = !!accessCode;

  return {
    accessCode,
    accessCodeId: accessCode?.id || null,
    loading,
    isAuthenticated,
    logout,
  };
}
