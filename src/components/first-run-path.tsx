'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, FileText, Loader2, Mic, Sparkles, UserCheck } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import { apiFetch } from '@/lib/api-client';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

interface OnboardingState {
  resumes: boolean;
  confirmed: boolean;
  personality: boolean;
  interview: boolean;
}

export function FirstRunPath() {
  const { locale, t } = useLanguage();
  const [state, setState] = useState<'guest' | 'loading' | 'ready'>('loading');
  const [onboarding, setOnboarding] = useState<OnboardingState>({
    resumes: false,
    confirmed: false,
    personality: false,
    interview: false,
  });

  useEffect(() => {
    let cancelled = false;
    getSupabaseBrowserClient()
      .then(async (supabase) => {
        const { data: session } = await supabase.auth.getSession();
        if (!session.session) {
          if (!cancelled) setState('guest');
          return;
        }
        const response = await apiFetch(`/api/dashboard?lang=${locale}`, { cache: 'no-store' });
        if (!response.ok) {
          if (!cancelled) setState('guest');
          return;
        }
        const json = (await response.json()) as {
          counts?: { resumes: number; interviews: number };
          personality?: { hasAssessment: boolean } | null;
          segmentationConfirmed?: boolean;
        };
        if (!cancelled) {
          setOnboarding({
            resumes: (json.counts?.resumes || 0) > 0,
            confirmed: json.segmentationConfirmed === true,
            personality: json.personality?.hasAssessment === true,
            interview: (json.counts?.interviews || 0) > 0,
          });
          setState('ready');
        }
      })
      .catch(() => {
        if (!cancelled) setState('guest');
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const steps = [
    { key: 'resumes', done: onboarding.resumes, title: t('onboarding.step1.title'), desc: t('onboarding.step1.desc'), href: '/resume?first=1', icon: FileText },
    { key: 'confirmed', done: onboarding.confirmed, title: t('onboarding.step2.title'), desc: t('onboarding.step2.desc'), href: '/resume', icon: UserCheck },
    { key: 'personality', done: onboarding.personality, title: t('onboarding.step3.title'), desc: t('onboarding.step3.desc'), href: '/personality', icon: Sparkles },
    { key: 'interview', done: onboarding.interview, title: t('onboarding.step4.title'), desc: t('onboarding.step4.desc'), href: '/mock-interview', icon: Mic },
  ] as const;

  if (state === 'loading') {
    return (
      <section className="px-4 pt-8">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
          </div>
        </div>
      </section>
    );
  }

  if (state === 'guest') {
    return (
      <section className="px-4 pt-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col gap-1 px-1 py-2">
            <div className="shrink-0">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {t('onboarding.title')}
              </h2>
              <p className="mt-0.5 text-xs text-zinc-400 whitespace-nowrap">{t('onboarding.subtitle')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
              {steps.map((step, index) => (
                <span key={step.key} className="inline-flex items-center gap-1.5">
                  <span className="whitespace-nowrap">{step.title}</span>
                  {index < steps.length - 1 && (
                    <ArrowRight className="h-3 w-3 text-zinc-300 dark:text-zinc-600" />
                  )}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }
  const nextStepIndex = steps.findIndex((step) => !step.done);

  if (nextStepIndex === -1) return null;

  return (
    <section className="px-4 pt-6 pb-4">
      <div className="max-w-6xl mx-auto">
        <div className="hidden md:block">
          <div className="flex items-start">
            {steps.map((step, index) => {
              const isDone = step.done;
              const isNext = index === nextStepIndex;
              const lineBeforeActive = index > 0 && steps[index - 1].done;
              const lineAfterActive = index < steps.length - 1 && step.done;
              return (
                <div key={step.key} className="flex-1 min-w-0">
                  <Link href={step.href} className="group block">
                    <div className="flex items-center">
                      <div className={`h-px flex-1 ${index === 0 ? 'bg-transparent' : lineBeforeActive ? 'bg-zinc-900 dark:bg-white' : 'bg-zinc-200 dark:bg-zinc-800'}`} />
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full border transition-colors shrink-0 ${
                        isDone
                          ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-zinc-900 dark:border-white'
                          : isNext
                            ? 'bg-transparent text-zinc-900 border-zinc-900 dark:text-white dark:border-white'
                            : 'bg-white text-zinc-400 border-zinc-200 dark:bg-zinc-950 dark:text-zinc-600 dark:border-zinc-700 group-hover:border-zinc-400'
                      }`}>
                        {isDone ? <Check className="h-5 w-5" /> : <step.icon className="h-[7px] w-[7px]" />}
                      </span>
                      <div className={`h-px flex-1 ${index === steps.length - 1 ? 'bg-transparent' : lineAfterActive ? 'bg-zinc-900 dark:bg-white' : 'bg-zinc-200 dark:bg-zinc-800'}`} />
                    </div>
                    <div className="mt-3 px-2 text-center">
                      <h3 className={`text-xs leading-snug ${isNext ? 'font-bold text-zinc-900 dark:text-white' : 'font-semibold text-zinc-900 dark:text-zinc-100'}`}>
                        {step.title}
                      </h3>
                      {isNext && (
                        <span className="mt-1.5 block text-[10px] font-medium text-zinc-900 dark:text-white">
                          {t('dashboard.nextAction')}
                        </span>
                      )}
                    </div>
                  </Link>
                </div>
              );
            })}
          </div>
        </div>

        <div className="md:hidden">
          {steps.map((step, index) => {
            const isDone = step.done;
            const isNext = index === nextStepIndex;
            return (
              <div key={step.key} className="relative flex gap-4 pb-5 last:pb-0">
                {index < steps.length - 1 && (
                  <span className={`absolute left-3 top-7 bottom-0 w-px ${isDone ? 'bg-zinc-900 dark:bg-white' : 'bg-zinc-200 dark:bg-zinc-800'}`} />
                )}
                <span className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full border shrink-0 ${
                  isDone
                    ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-zinc-900 dark:border-white'
                    : isNext
                      ? 'bg-transparent text-zinc-900 border-zinc-900 dark:text-white dark:border-white'
                      : 'bg-white text-zinc-400 border-zinc-200 dark:bg-zinc-950 dark:text-zinc-600 dark:border-zinc-700'
                }`}>
                  {isDone ? <Check className="h-5 w-5" /> : <step.icon className="h-[7px] w-[7px]" />}
                </span>
                <Link
                  href={step.href}
                  className={`flex-1 min-w-0 pt-1 ${isNext ? 'text-zinc-900 dark:text-white' : 'text-zinc-600 dark:text-zinc-400'}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className={`text-xs ${isNext ? 'font-bold' : 'font-medium'}`}>
                      {step.title}
                    </h3>
                    {isNext && (
                      <span className="shrink-0 text-[10px] font-medium">
                        {t('dashboard.nextAction')}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-400 leading-relaxed">{step.desc}</p>
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
