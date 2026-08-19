'use client';

import Link from 'next/link';
import { Check, Sparkles } from 'lucide-react';
import { Header1 } from '@/components/header1';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLanguage } from '@/lib/language-context';

export default function PricingPage() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <Header1 />
      <main className="pt-20 pb-16 px-4 max-w-6xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-2xl md:text-3xl font-semibold text-zinc-900 dark:text-zinc-50">
            {t('pricing.title')}
          </h1>
          <p className="mt-3 text-zinc-500 max-w-xl mx-auto leading-relaxed">
            {t('pricing.subtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
            <CardContent className="p-8">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {t('pricing.basicName')}
                </h2>
                <span className="text-xs font-medium text-zinc-500 px-2 py-1 rounded-full bg-zinc-100 dark:bg-zinc-900">
                  {t('pricing.free')}
                </span>
              </div>
              <p className="text-sm text-zinc-500 leading-relaxed mb-6">
                {t('pricing.basicDesc')}
              </p>
              <ul className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300 mb-8">
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-500" />{t('nav.resumeManager')}</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-500" />{t('nav.jobSearch')}</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-500" />{t('nav.aiMatch')}</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-500" />{t('nav.atsOptimize')}</li>
              </ul>
              <Button asChild variant="outline" className="w-full rounded-full">
                <Link href="/account/billing">{t('pricing.basicCta')}</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-zinc-900 dark:border-white overflow-hidden">
            <CardContent className="p-8">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {t('pricing.proName')}
                </h2>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-white px-2 py-1 rounded-full bg-zinc-900 dark:bg-white dark:text-zinc-900">
                  <Sparkles className="h-3 w-3" />
                  Pro
                </span>
              </div>
              <p className="text-sm text-zinc-500 leading-relaxed mb-4">
                {t('pricing.proDesc')}
              </p>
              <div className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100 mb-6">
                {t('pricing.proMonthly')}
                <span className="block text-sm font-normal text-zinc-500 mt-1">{t('pricing.proYearly')}</span>
              </div>
              <Button disabled className="w-full rounded-full bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
                {t('pricing.proCta')}
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
