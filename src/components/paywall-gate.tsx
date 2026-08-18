'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Lock, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useLanguage } from '@/lib/language-context';
import type { FeatureCode } from '@/lib/billing-types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function PaywallGate({
  feature,
  allowGrant = false,
  children,
}: {
  feature: FeatureCode;
  allowGrant?: boolean;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  const [state, setState] = useState<'loading' | 'allowed' | 'blocked'>('loading');

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/billing/status')
      .then((res) => (res.ok ? res.json() : { billing: null }))
      .then((json) => {
        if (cancelled) return;
        const billing = json.billing;
        if (!billing) {
          setState('blocked');
          return;
        }
        const entitlement = billing.features?.[feature];
        const allowed = billing.isPro
          || (allowGrant && Number(entitlement?.grantRemaining || 0) > 0);
        setState(allowed ? 'allowed' : 'blocked');
      })
      .catch(() => {
        if (!cancelled) setState('blocked');
      });
    return () => {
      cancelled = true;
    };
  }, [feature, allowGrant]);

  if (state === 'loading') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (state === 'blocked') {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4 py-10">
        <Card className="w-full max-w-lg rounded-2xl border-zinc-200 dark:border-zinc-800">
          <CardContent className="p-8 flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-xl bg-zinc-900 text-white flex items-center justify-center mb-4">
              <Lock className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
              {t('paywall.title')}
            </h2>
            <p className="text-sm text-zinc-500 leading-relaxed mb-6 max-w-sm">
              {t('paywall.description')}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button asChild className="rounded-full bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
                <Link href="/pricing">{t('paywall.upgrade')}</Link>
              </Button>
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/">{t('paywall.cancel')}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
