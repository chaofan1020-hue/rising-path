'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import SubscriptionCelebration from '@/components/SubscriptionCelebration';

export default function RegisterSuccessPage() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace('/dashboard');
    }, 4200);
    return () => clearTimeout(timer);
  }, [router]);

  return <SubscriptionCelebration open={true} onClose={() => router.replace('/dashboard')} />;
}
