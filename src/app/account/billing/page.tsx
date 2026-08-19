'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BadgeCheck, CreditCard, Sparkles } from 'lucide-react';
import { AuthGuard } from '@/components/auth-guard';
import { Header1 } from '@/components/header1';
import { apiFetch } from '@/lib/api-client';
import { useLanguage } from '@/lib/language-context';
import { FEATURE_CODES, type BillingSnapshot } from '@/lib/billing-types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';

interface BillingStatus {
  billing: BillingSnapshot;
  subscription: {
    status: string;
    billing_interval: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
  } | null;
}

function featureLabel(feature: string, t: (key: string) => string): string {
  const labels: Record<string, string> = {
    ai_match: t('nav.aiMatch'),
    ats_optimize: t('nav.atsOptimize'),
    mock_interview: t('nav.mockInterview'),
    networking: 'Networking',
    auto_apply: t('nav.autoApplication'),
  };
  return labels[feature] || feature;
}

export default function AccountBillingPage() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/billing/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json) setStatus(json as BillingStatus);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AuthGuard>
      <div className="min-h-screen bg-white dark:bg-zinc-950">
        <Header1 />
        <main className="pt-20 pb-16 px-4 max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <Button asChild variant="ghost" size="sm" className="rounded-full mb-2">
                <Link href="/"><ArrowLeft className="h-4 w-4 mr-1" />{t('billing.backToApp')}</Link>
              </Button>
              <h1 className="text-xl md:text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                {t('billing.title')}
              </h1>
              <p className="text-sm text-zinc-500 mt-1">{t('billing.subtitle')}</p>
            </div>
            <Button asChild className="rounded-full bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
              <Link href="/pricing">
                <Sparkles className="h-4 w-4 mr-1.5" />
                {t('billing.upgrade')}
              </Link>
            </Button>
          </div>

          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-32 w-full rounded-2xl" />
              <Skeleton className="h-48 w-full rounded-2xl" />
            </div>
          ) : status ? (
            <>
              <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800 mb-6">
                <CardContent className="p-6 flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
                    {status.billing.isPro ? <BadgeCheck className="h-5 w-5" /> : <CreditCard className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium uppercase tracking-widest text-zinc-400">
                      {t('billing.currentPlan')}
                    </p>
                    <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                      {status.billing.planName}
                    </p>
                  </div>
                  <span className="text-xs font-medium px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300">
                    {status.subscription?.status || 'active'}
                  </span>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
                <CardContent className="p-6">
                  <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-5">
                    {t('billing.featureUsage')}
                  </h2>
                  <div className="space-y-5">
                    {FEATURE_CODES.map((feature) => {
                      const ent = status.billing.features[feature];
                      if (!ent) return null;
                      const total = ent.quotaLimit;
                      const used = ent.quotaUsed;
                      const unlimited = total === null;
                      const grantRemaining = ent.grantRemaining || 0;
                      const percent = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, total)) * 100));
                      return (
                        <div key={feature}>
                          <div className="flex items-center justify-between text-sm mb-1.5">
                            <span className="font-medium text-zinc-800 dark:text-zinc-200">
                              {featureLabel(feature, t)}
                            </span>
                            <span className="text-zinc-500">
                              {unlimited
                                ? t('billing.unlimited')
                                : `${t('billing.remaining')} ${Math.max(0, total - used)} / ${total}`}
                            </span>
                          </div>
                          {!unlimited && <Progress value={percent} className="h-1.5" />}
                          {grantRemaining > 0 && (
                            <p className="text-xs text-zinc-400 mt-1">
                              {t('billing.remaining')} {grantRemaining}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <p className="text-sm text-zinc-500">{t('billing.subtitle')}</p>
          )}
        </main>
      </div>
    </AuthGuard>
  );
}
