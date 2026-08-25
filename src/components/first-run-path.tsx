'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, FileText, Mic, RefreshCw, Sparkles, UserCheck } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

interface OnboardingState {
  resumes: boolean;
  confirmed: boolean;
  personality: boolean;
  interview: boolean;
}

type PathStatus = 'loading' | 'guest' | 'ready' | 'unavailable';

const emptyOnboarding: OnboardingState = {
  resumes: false,
  confirmed: false,
  personality: false,
  interview: false,
};

const ONBOARDING_CACHE_TTL_MS = 15 * 60 * 1000;

function onboardingCacheKey(userId: string) {
  return `liorvix.onboarding.${userId}.v1`;
}

function readOnboardingCache(userId: string): OnboardingState | null {
  try {
    const raw = window.sessionStorage.getItem(onboardingCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; state?: OnboardingState };
    if (!parsed.savedAt || !parsed.state || Date.now() - parsed.savedAt > ONBOARDING_CACHE_TTL_MS) return null;
    return parsed.state;
  } catch {
    return null;
  }
}

function writeOnboardingCache(userId: string, state: OnboardingState) {
  try {
    window.sessionStorage.setItem(onboardingCacheKey(userId), JSON.stringify({ savedAt: Date.now(), state }));
  } catch {
    // Storage is an acceleration only; private browsing can disable it.
  }
}

function message(locale: string, key: 'retry' | 'unavailable' | 'next' | 'done') {
  const english = locale.startsWith('en');
  if (key === 'retry') return english ? 'Retry' : '重新加载';
  if (key === 'unavailable') return english ? 'Path progress is temporarily unavailable. You can still start from any step.' : '路径进度暂时无法读取，你仍可以从任意一步开始。';
  if (key === 'next') return english ? 'Next step' : '下一步';
  return english ? 'Completed' : '已完成';
}

export function FirstRunPath() {
  const { locale, t } = useLanguage();
  const [status, setStatus] = useState<PathStatus>('loading');
  const [onboarding, setOnboarding] = useState<OnboardingState>(emptyOnboarding);
  const [reloadKey, setReloadKey] = useState(0);

  const loadPath = useCallback(async (signal: AbortSignal) => {
    setStatus('loading');
    try {
      const supabase = await getSupabaseBrowserClient();
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!data.session) {
        setOnboarding(emptyOnboarding);
        setStatus('guest');
        return;
      }

      const requestState = async () => {
        const response = await fetch('/api/onboarding', {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          signal,
        });
        if (!response.ok) throw new Error(`onboarding status ${response.status}`);
        const json = (await response.json()) as { onboarding?: OnboardingState };
        return json.onboarding ?? emptyOnboarding;
      };

      const cachedState = reloadKey === 0 ? readOnboardingCache(data.session.user.id) : null;
      if (cachedState) {
        setOnboarding(cachedState);
        setStatus('ready');
        void requestState()
          .then((nextState) => writeOnboardingCache(data.session.user.id, nextState))
          .catch(() => undefined);
        return;
      }

      const nextState = await requestState();
      if (signal.aborted) return;
      writeOnboardingCache(data.session.user.id, nextState);
      setOnboarding(nextState);
      setStatus('ready');
    } catch (error) {
      if (signal.aborted) return;
      console.error('[FirstRunPath] Failed to load onboarding state:', error);
      setOnboarding(emptyOnboarding);
      setStatus('unavailable');
    }
  }, [reloadKey]);

  useEffect(() => {
    const controller = new AbortController();
    void loadPath(controller.signal);
    return () => controller.abort();
  }, [loadPath, reloadKey]);

  const steps = useMemo(() => [
    { key: 'resumes', done: onboarding.resumes, title: t('onboarding.step1.title'), desc: t('onboarding.step1.desc'), href: '/resume?first=1', icon: FileText },
    { key: 'confirmed', done: onboarding.confirmed, title: t('onboarding.step2.title'), desc: t('onboarding.step2.desc'), href: '/resume', icon: UserCheck },
    { key: 'personality', done: onboarding.personality, title: t('onboarding.step3.title'), desc: t('onboarding.step3.desc'), href: '/personality', icon: Sparkles },
    { key: 'interview', done: onboarding.interview, title: t('onboarding.step4.title'), desc: t('onboarding.step4.desc'), href: '/mock-interview', icon: Mic },
  ], [onboarding, t]);

  const nextStepIndex = status === 'ready' ? steps.findIndex((step) => !step.done) : 0;
  const completed = nextStepIndex === -1;
  const activeIndex = completed ? steps.length - 1 : nextStepIndex;
  const progressPercent = completed ? 100 : Math.max(0, (activeIndex / (steps.length - 1)) * 100);

  return <section className="px-4 pb-2 pt-2 sm:pb-3 sm:pt-3">
    <div className="mx-auto max-w-7xl">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 sm:mb-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">{t('onboarding.title')}</p>
          <h2 className="text-sm font-semibold tracking-tight text-zinc-950 dark:text-white sm:text-base">{t('home.pathTitle')}</h2>
          <p className="hidden text-xs text-zinc-500 dark:text-zinc-400 lg:block">{t('onboarding.subtitle')}</p>
        </div>
        {status === 'unavailable' && <button type="button" onClick={() => setReloadKey((value) => value + 1)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"><RefreshCw className="h-4 w-4" />{message(locale, 'retry')}</button>}
      </div>

      {status === 'unavailable' && <p role="status" className="mb-5 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 text-sm text-foreground dark:bg-primary/15">{message(locale, 'unavailable')}</p>}

      {/* The path is intentionally visible before the session/API round trip finishes.
          A blank section made the homepage feel blocked by authentication latency. */}
      <div className="first-run-path-scroll overflow-x-auto pb-0.5">
        <div className="relative min-w-[540px] px-2 pt-0.5 sm:min-w-0 sm:px-4">
          <div className="absolute left-[12.5%] right-[12.5%] top-[1rem] h-px overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div className="h-full rounded-full bg-zinc-900 dark:bg-white" style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="grid grid-cols-4 gap-2 sm:gap-3">
            {steps.map((step, index) => {
              const isDone = status === 'ready' && step.done;
              const isCurrent = index === activeIndex && !completed;
              const Icon = step.icon;
              return <Link key={step.key} href={step.href} title={step.desc} className="first-run-path-step group relative block min-w-0 text-center outline-none">
                <span className={`relative z-10 mx-auto flex h-8 w-8 items-center justify-center rounded-full border bg-background shadow-sm transition-all duration-300 group-hover:-translate-y-0.5 group-hover:shadow-md ${isDone ? 'border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900' : isCurrent ? 'border-zinc-900 text-zinc-900 dark:border-white dark:text-white' : 'border-zinc-300 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500'}`}>
                  {isDone ? <Check className="h-4 w-4" strokeWidth={2.4} /> : <Icon className="h-4 w-4" strokeWidth={1.8} />}
                </span>
                <div className="mx-auto mt-1 max-w-[138px]">
                  <div className="flex min-h-4 items-center justify-center gap-1"><h3 className={`line-clamp-1 text-xs leading-4 ${isCurrent ? 'font-bold text-zinc-950 dark:text-white' : 'font-semibold text-zinc-800 dark:text-zinc-200'}`}>{step.title}</h3>{isDone && <Check className="h-2.5 w-2.5 text-emerald-600 dark:text-emerald-400" />}</div>
                </div>
              </Link>;
            })}
          </div>
        </div>
      </div>
    </div>
  </section>;
}
