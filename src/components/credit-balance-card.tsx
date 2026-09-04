'use client';

import { useEffect, useState } from 'react';
import { Coins, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import { useLanguage } from '@/lib/language-context';

export function CreditBalanceCard() {
  const { locale, t } = useLanguage();
  const [balance, setBalance] = useState<number | null>(null);
  const [spent, setSpent] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/credits', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('credit query failed');
        const json = await response.json();
        if (!cancelled) {
          setBalance(Number(json.data?.balance || 0));
          setSpent(Number(json.data?.lifetimeSpent || 0));
        }
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);

  const numberLocale = locale === 'en' ? 'en-US' : locale === 'zh-TW' ? 'zh-TW' : 'zh-CN';
  return (
    <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"><Coins className="h-4 w-4" /></span>
          <div><p className="text-xs font-medium uppercase tracking-widest text-zinc-400">{t('credits.balanceLabel')}</p><p className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">{balance === null && !error ? <Loader2 className="h-5 w-5 animate-spin" /> : error ? t('credits.unavailable') : `${new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 2 }).format(balance || 0)} ${t('credits.unit')}`}</p>{spent !== null && <p className="mt-1 text-xs text-zinc-500">{t('credits.spent', { count: new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 2 }).format(spent) })}</p>}</div>
        </div>
        <Button asChild variant="outline" size="sm"><Link href="/account/credits">{t('credits.viewHistory')}<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
      </CardContent>
    </Card>
  );
}
