'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import 'altcha';
import 'altcha/i18n/zh-cn';
import 'altcha/i18n/zh-tw';
import 'altcha/i18n/en';
import type {} from 'altcha/types/react';

const ALTCHA_CONFIGURATION = JSON.stringify({
  hideFooter: true,
  hideLogo: true,
});

function localeToAltchaLanguage(locale?: string): string {
  if (locale === 'zh-TW' || locale === 'zh-tw') return 'zh-tw';
  if (locale === 'en') return 'en';
  return 'zh-cn';
}

function AltchaWidget({
  language,
  onToken,
  resetSignal = 0,
}: {
  language: string;
  onToken: (token: string | null) => void;
  resetSignal?: number;
}) {
  const widgetRef = useRef<HTMLElement | null>(null);
  const onTokenRef = useRef(onToken);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    const widget = widgetRef.current;
    if (!widget) return undefined;

    onTokenRef.current(null);
    const handleStateChange = (event: Event) => {
      const detail = (event as CustomEvent<{ payload?: string; state?: string }>).detail;
      if (detail?.state === 'verified' && typeof detail.payload === 'string' && detail.payload) {
        onTokenRef.current(detail.payload);
        return;
      }
      onTokenRef.current(null);
    };

    widget.addEventListener('statechange', handleStateChange);
    return () => {
      widget.removeEventListener('statechange', handleStateChange);
      onTokenRef.current(null);
    };
  }, [resetSignal]);

  return (
    <div key={resetSignal} className="w-full">
      <altcha-widget
        ref={(node) => {
          widgetRef.current = node;
        }}
        challenge="/api/auth/captcha"
        configuration={ALTCHA_CONFIGURATION}
        language={language}
        type="checkbox"
        style={{
          width: '100%',
          maxWidth: '100%',
          '--altcha-border-color': '#e4e4e7',
          '--altcha-border-radius': '8px',
          '--altcha-color-base': '#fafafa',
          '--altcha-max-width': '100%',
        }}
      />
    </div>
  );
}

export function HumanVerification({
  onToken,
  onEnabled,
  resetSignal = 0,
  language,
}: {
  onToken: (token: string | null) => void;
  onEnabled?: (enabled: boolean) => void;
  resetSignal?: number;
  language?: string;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const onEnabledRef = useRef(onEnabled);
  const onTokenRef = useRef(onToken);
  const isClient = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  useEffect(() => {
    onEnabledRef.current = onEnabled;
    onTokenRef.current = onToken;
  }, [onEnabled, onToken]);

  useEffect(() => {
    let cancelled = false;
    setError('');
    void fetch('/api/auth/config', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json() as { captchaEnabled?: boolean };
        if (cancelled) return;
        const nextEnabled = Boolean(data.captchaEnabled);
        setEnabled(nextEnabled);
        onEnabledRef.current?.(nextEnabled);
        if (!nextEnabled) onTokenRef.current(null);
      })
      .catch(() => {
        if (cancelled) return;
        setError('人机验证加载失败');
        setEnabled(null);
        onEnabledRef.current?.(true);
        onTokenRef.current(null);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (error) {
    return (
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 text-left text-sm dark:border-zinc-800 dark:bg-zinc-900"
        onClick={() => {
          setError('');
          setReloadKey((value) => value + 1);
        }}
      >
        <span>{error}</span>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
          <RefreshCw className="h-3.5 w-3.5" />
          重试
        </span>
      </button>
    );
  }

  if (enabled === null || !isClient) {
    return (
      <div className="flex min-h-[65px] items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        <Loader2 className="h-4 w-4 animate-spin" />
        正在加载人机验证
      </div>
    );
  }

  if (!enabled) return null;

  return (
    <AltchaWidget
      language={localeToAltchaLanguage(language)}
      onToken={onToken}
      resetSignal={resetSignal}
    />
  );
}
