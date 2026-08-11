'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PageBackButtonProps {
  fallbackHref: string;
  label?: string;
  className?: string;
}

export default function PageBackButton({ fallbackHref, label = '返回', className }: PageBackButtonProps) {
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    try {
      const safeBack =
        typeof window !== 'undefined' &&
        window.history.length > 1 &&
        !!document.referrer &&
        !document.referrer.includes('/applications');
      setCanGoBack(safeBack);
    } catch {
      setCanGoBack(false);
    }
  }, []);

  const handleClick = () => {
    if (canGoBack) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  };

  return (
    <Button variant="ghost" onClick={handleClick} className={`h-9 text-sm text-muted-foreground ${className || ''}`}>
      <ArrowLeft className="h-4 w-4 mr-2" />
      {label}
    </Button>
  );
}
