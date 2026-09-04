'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Clipboard, ExternalLink, Loader2, Puzzle, RefreshCw, ShieldCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/language-context';

export interface AutoApplyContext {
  jobId: number;
  company: string;
  title: string;
  jobUrl: string;
  resumeId?: number;
}

type ExtensionStatus = 'checking' | 'connected' | 'missing';

function isReadyMessage(event: MessageEvent): boolean {
  return event.source === window
    && event.origin === window.location.origin
    && event.data?.type === 'liorvix-extension-ready';
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map(stringifyValue)
      .filter(Boolean)
      .join(' | ');
  }
  return value == null ? '' : String(value);
}

function profileToText(profile: unknown, context: AutoApplyContext, t: (key: string) => string): string {
  const root = profile && typeof profile === 'object' ? profile as Record<string, unknown> : {};
  const personal = root.personal && typeof root.personal === 'object' ? root.personal as Record<string, unknown> : {};
  const links = root.links && typeof root.links === 'object' ? root.links as Record<string, unknown> : {};
  const lines = [
    `${t('autoApply.targetJob')}: ${context.company} · ${context.title}`,
    `${t('autoApply.jobLink')}: ${context.jobUrl}`,
    '',
    `${t('resume.name')}: ${stringifyValue(personal.fullName) || `${stringifyValue(personal.firstName)} ${stringifyValue(personal.lastName)}`.trim()}`,
    `${t('resume.email')}: ${stringifyValue(personal.email)}`,
    `${t('resume.phone')}: ${stringifyValue(personal.phone)}`,
    `${t('resume.location')}: ${stringifyValue(personal.address)}`,
    `${t('autoApply.city')}: ${stringifyValue(personal.city)}`,
    `${t('autoApply.state')}: ${stringifyValue(personal.state)}`,
    `${t('autoApply.zipCode')}: ${stringifyValue(personal.zipCode)}`,
    `${t('resume.profileWorkAuthorization')}: ${stringifyValue(root.workAuthorization)}`,
    `${t('resume.profileVisaStatus')}: ${stringifyValue(root.visaStatus)}`,
    `${t('autoApply.linkedin')}: ${stringifyValue(links.linkedin)}`,
    `${t('autoApply.github')}: ${stringifyValue(links.github)}`,
    `${t('autoApply.portfolio')}: ${stringifyValue(links.portfolio)}`,
    `${t('resume.skills')}: ${stringifyValue(root.skills)}`,
    `${t('autoApply.languages')}: ${stringifyValue(root.languages)}`,
    `${t('autoApply.summary')}: ${stringifyValue(root.summary)}`,
  ];
  return lines.filter((line, index) => index < 3 || line.slice(line.indexOf(':') + 1).trim()).join('\n');
}

export function AutoApplyAssistant({ context }: { context: AutoApplyContext }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<ExtensionStatus>('checking');
  const [extensionVersion, setExtensionVersion] = useState('');
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);

  const contextRef = useRef(context);

  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  useEffect(() => {
    const handleReady = (event: MessageEvent) => {
      if (!isReadyMessage(event)) return;
      const version = typeof event.data.version === 'string' ? event.data.version : '';
      setExtensionVersion(version);
      setStatus('connected');
      window.postMessage({ type: 'liorvix-apply-context', context: contextRef.current }, window.location.origin);
    };

    window.addEventListener('message', handleReady);
    const ping = () => {
      window.postMessage({
        type: 'liorvix-extension-ping',
        requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      }, window.location.origin);
    };
    ping();
    const intervalId = window.setInterval(ping, 500);
    const timeoutId = window.setTimeout(() => setStatus((current) => current === 'connected' ? current : 'missing'), 2_500);

    return () => {
      window.removeEventListener('message', handleReady);
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    if (status === 'connected') {
      window.postMessage({ type: 'liorvix-apply-context', context: contextRef.current }, window.location.origin);
    }
  }, [context.company, context.jobId, context.jobUrl, context.resumeId, context.title, status]);

  const retry = () => {
    setStatus('checking');
    setExtensionVersion('');
    window.postMessage({
      type: 'liorvix-extension-ping',
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }, window.location.origin);
    window.setTimeout(() => setStatus((current) => current === 'connected' ? current : 'missing'), 1_500);
  };

  const copyProfile = async () => {
    setCopying(true);
    setCopied(false);
    try {
      const response = await apiFetch('/api/application-profile');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('autoApply.copyFailed'));
      await navigator.clipboard.writeText(profileToText(data.profile, context, t));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : t('autoApply.copyFailed'));
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
            <Puzzle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('autoApply.browserAssistant')}</p>
              {status === 'connected' && <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"><ShieldCheck className="h-3 w-3" />{t('autoApply.connected')}</span>}
            </div>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400" aria-live="polite">
            {status === 'checking' && t('autoApply.checking')}
            {status === 'connected' && `${t('autoApply.connectedHint')}${extensionVersion ? ` · v${extensionVersion}` : ''}`}
            {status === 'missing' && t('autoApply.missingHint')}
            </p>
          </div>
        </div>
        {status === 'missing' ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={copyProfile} disabled={copying}>
              {copying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Clipboard className="mr-1.5 h-3.5 w-3.5" />}
              {copied ? t('autoApply.copied') : t('autoApply.copyProfile')}
            </Button>
            <Button asChild size="sm" className="h-8 bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900"><Link href="/extension"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />{t('autoApply.install')}</Link></Button>
          </div>
        ) : (
          <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0" onClick={retry} disabled={status === 'checking'}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${status === 'checking' ? 'animate-spin' : ''}`} />{t('autoApply.retry')}</Button>
        )}
      </div>
    </div>
  );
}
