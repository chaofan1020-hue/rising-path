'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const failedPrimaryUrls = new Set<string>();

const SIZE_CLASS = {
  sm: 'w-8 h-8',
  md: 'w-12 h-12',
  lg: 'w-16 h-16',
} as const;

function companyInitial(company: string): string {
  if (!company) return '?';
  if (/[\u4e00-\u9fa5]/.test(company)) return company.charAt(0);
  const words = company.split(/[\s-]+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
  }
  return company.charAt(0).toUpperCase();
}

export function CompanyLogo({
  company,
  logoUrl,
  fallbackLogoUrl,
  size = 'md',
  className,
}: {
  company: string;
  logoUrl?: string | null;
  fallbackLogoUrl?: string | null;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}) {
  const [failedSource, setFailedSource] = useState<'primary' | 'fallback' | null>(
    () => (logoUrl && failedPrimaryUrls.has(logoUrl) ? 'primary' : null),
  );

  useEffect(() => {
    setFailedSource(logoUrl && failedPrimaryUrls.has(logoUrl) ? 'primary' : null);
  }, [logoUrl, fallbackLogoUrl]);

  const logoSource = failedSource === 'primary'
    ? fallbackLogoUrl
    : failedSource === 'fallback'
      ? null
      : logoUrl;

  if (logoSource) {
    return (
      <div className={cn(SIZE_CLASS[size], 'rounded-xl overflow-hidden bg-white border border-zinc-200 dark:border-zinc-700 flex-shrink-0', className)}>
        <img
          src={logoSource}
          alt={`${company} logo`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className={size === 'lg' ? 'w-full h-full object-contain p-1.5' : 'w-full h-full object-contain p-1'}
          onError={() => {
            if (logoSource === logoUrl && fallbackLogoUrl) {
              if (logoUrl) failedPrimaryUrls.add(logoUrl);
              setFailedSource('primary');
              return;
            }
            setFailedSource('fallback');
          }}
        />
      </div>
    );
  }

  return (
    <div className={cn(SIZE_CLASS[size], 'rounded-xl bg-zinc-900 dark:bg-white flex items-center justify-center flex-shrink-0 shadow-lg shadow-zinc-900/15 dark:shadow-black/30', className)}>
      <span className={`${size === 'lg' ? 'text-2xl' : 'text-lg'} font-bold text-white dark:text-zinc-900`}>
        {companyInitial(company)}
      </span>
    </div>
  );
}
