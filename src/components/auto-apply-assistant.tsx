'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Clipboard, Loader2, Puzzle, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { Button } from '@/components/ui/button';

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

function profileToText(profile: unknown, context: AutoApplyContext): string {
  const root = profile && typeof profile === 'object' ? profile as Record<string, unknown> : {};
  const personal = root.personal && typeof root.personal === 'object' ? root.personal as Record<string, unknown> : {};
  const links = root.links && typeof root.links === 'object' ? root.links as Record<string, unknown> : {};
  const lines = [
    `目标岗位：${context.company} · ${context.title}`,
    `岗位链接：${context.jobUrl}`,
    '',
    `姓名：${stringifyValue(personal.fullName) || `${stringifyValue(personal.firstName)} ${stringifyValue(personal.lastName)}`.trim()}`,
    `邮箱：${stringifyValue(personal.email)}`,
    `电话：${stringifyValue(personal.phone)}`,
    `地址：${stringifyValue(personal.address)}`,
    `城市：${stringifyValue(personal.city)}`,
    `州/省：${stringifyValue(personal.state)}`,
    `邮编：${stringifyValue(personal.zipCode)}`,
    `工作授权：${stringifyValue(root.workAuthorization)}`,
    `签证状态：${stringifyValue(root.visaStatus)}`,
    `LinkedIn：${stringifyValue(links.linkedin)}`,
    `GitHub：${stringifyValue(links.github)}`,
    `作品集：${stringifyValue(links.portfolio)}`,
    `技能：${stringifyValue(root.skills)}`,
    `语言：${stringifyValue(root.languages)}`,
    `个人简介：${stringifyValue(root.summary)}`,
  ];
  return lines.filter((line, index) => index < 3 || line.split('：')[1]?.trim()).join('\n');
}

export function AutoApplyAssistant({ context }: { context: AutoApplyContext }) {
  const [status, setStatus] = useState<ExtensionStatus>('checking');
  const [extensionVersion, setExtensionVersion] = useState('');
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);

  const contextRef = useRef(context);

  useEffect(() => {
    contextRef.current = context;
  }, [context.company, context.jobId, context.jobUrl, context.resumeId, context.title]);

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
      if (!response.ok) throw new Error(data.error || '获取求职资料失败');
      await navigator.clipboard.writeText(profileToText(data.profile, context));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '复制求职资料失败，请重试');
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-50/70 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900/50 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
          <Puzzle className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">自动填写助手</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400" aria-live="polite">
            {status === 'checking' && '正在检查连接…'}
            {status === 'connected' && `已连接${extensionVersion ? ` · v${extensionVersion}` : ''}`}
            {status === 'missing' && '未检测到扩展，仍可打开原链接手动填写'}
          </p>
        </div>
      </div>
      {status === 'missing' ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={copyProfile} disabled={copying}>
            {copying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Clipboard className="mr-1.5 h-3.5 w-3.5" />}
            {copied ? '已复制' : '复制求职资料'}
          </Button>
          <Button asChild size="sm" className="h-8 bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900">
            <Link href="/extension">安装助手</Link>
          </Button>
        </div>
      ) : (
        <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0" onClick={retry} disabled={status === 'checking'}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${status === 'checking' ? 'animate-spin' : ''}`} />
          重新检测
        </Button>
      )}
    </div>
  );
}
