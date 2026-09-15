'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/language-context';
import type { ResumeAvailabilityStatus } from '@/lib/resume-availability';

const STATUS_MESSAGE_KEY: Record<Exclude<ResumeAvailabilityStatus, 'ready'>, string> = {
  none: 'resume.gate.none',
  processing: 'resume.gate.processing',
  failed: 'resume.gate.failed',
  confirm: 'resume.gate.confirm',
};

export function ResumeAvailabilityHint({
  status,
  loading = false,
  error,
  onRetry,
  className = '',
}: {
  status: ResumeAvailabilityStatus;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const { t } = useLanguage();

  if (loading && status === 'none') {
    return (
      <p className={`text-sm text-zinc-500 dark:text-zinc-400 ${className}`.trim()}>
        {t('resume.loading')}
      </p>
    );
  }

  if (error) {
    return (
      <div className={`flex flex-wrap items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5 text-sm text-foreground dark:bg-primary/15 ${className}`.trim()}>
        <span>{t('resume.listLoadFailed')}</span>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry} className="h-8">
            {t('common.retry')}
          </Button>
        )}
      </div>
    );
  }

  if (status === 'ready') return null;

  return (
    <div className={`flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/5 px-3 py-3 text-sm text-foreground dark:bg-primary/15 md:flex-row md:items-center md:justify-between ${className}`.trim()}>
      <span>{t(STATUS_MESSAGE_KEY[status])}</span>
      <Button asChild size="sm" className="h-9 shrink-0">
        <Link href="/resume">{t('resume.gate.go')}</Link>
      </Button>
    </div>
  );
}
