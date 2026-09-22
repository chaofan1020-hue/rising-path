'use client';

import { AuthGuard } from '@/components/auth-guard';
import { Header1 } from '@/components/header1';
import ApplicationList from '@/components/application-list';
import { useLanguage } from '@/lib/language-context';

export default function ApplicationsPage() {
  const { t } = useLanguage();
  return <AuthGuard><div className="min-h-screen bg-white dark:bg-background"><Header1 /><div className="light-scope rounded-t-3xl bg-white pt-8 md:pt-10"><main className="container mx-auto max-w-5xl px-4 pb-16 pt-6 md:px-6 md:pt-8"><div className="mb-8"><h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 md:text-3xl">{t('page.applications.title')}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">{t('page.applications.subtitle')}</p></div><ApplicationList /></main></div></div></AuthGuard>;
}
