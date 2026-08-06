'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AccessCodePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/register');
  }, [router]);

  return null;
}
