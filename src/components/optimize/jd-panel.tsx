'use client';

import { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Pencil, X } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';

export type JdOrigin = 'job' | 'fetched' | 'manual' | null;

interface JdPanelProps {
  content: string;
  origin: JdOrigin;
  fetching: boolean;
  /** 面板内联错误（不阻塞主流程） */
  error: string;
  /** 模糊匹配提示（按公司/岗位名取到的最接近 JD） */
  matchNote: string;
  onChange: (value: string) => void;
  onDismissError: () => void;
  onClear: () => void;
}

/**
 * 岗位描述面板：全页唯一一处 JD 展示位。
 *
 * 收起时只显示「已关联 JD · N 字」，展开后是只读预览；点「手动修改」才变成
 * 可编辑 textarea。默认收起，避免同一份 JD 在 textarea 和卡片里出现两次。
 */
export function JdPanel({
  content,
  origin,
  fetching,
  error,
  matchNote,
  onChange,
  onDismissError,
  onClear,
}: JdPanelProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  const charCount = content.trim().length;
  const summaryLabel = fetching
    ? t('optimize.jdFetching')
    : charCount > 0
      ? origin === 'job'
        ? t('optimize.jdAutoLinked', { count: charCount })
        : origin === 'fetched'
          ? t('optimize.jdFetched', { count: charCount })
          : t('optimize.jdManualCount', { count: charCount })
      : t('optimize.jdNoContent');

  return (
    <section aria-labelledby="jd-panel-heading">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-[11px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          3
        </span>
        <span id="jd-panel-heading" className="text-xs font-medium text-zinc-900 md:text-sm dark:text-zinc-100">
          {t('optimize.jdLabel')}
        </span>
        <span className="inline-flex items-center rounded-full border border-zinc-200 px-2 py-0.5 text-[10px] text-zinc-500 dark:border-zinc-700">
          {t('optimize.optionalBadge')}
        </span>
      </div>

      {error && (
        <div className="mb-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={onDismissError}
            aria-label={t('optimize.dismiss')}
            className="shrink-0 text-amber-500 transition-colors hover:text-amber-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {matchNote && (
        <p className="mb-2 text-[11px] text-amber-600 dark:text-amber-400">{matchNote}</p>
      )}

      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => {
            setOpen((current) => !current);
            setEditing(false);
          }}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
          )}
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-600 dark:text-zinc-300">{summaryLabel}</span>
          {charCount > 0 && (
            <span className="shrink-0 text-[11px] text-zinc-400">
              {editing ? t('optimize.jdEditing') : t('optimize.jdView')}
            </span>
          )}
        </button>

        {open && (
          <div className="border-t border-zinc-200 dark:border-zinc-800">
            {editing || charCount === 0 ? (
              <textarea
                placeholder={t('optimize.jdPlaceholder')}
                value={content}
                onChange={(event) => onChange(event.target.value)}
                className="min-h-[140px] w-full resize-y bg-white p-3 text-xs text-zinc-700 focus:outline-none dark:bg-zinc-950 dark:text-zinc-200 md:text-sm"
              />
            ) : (
              <div className="max-h-56 overflow-y-auto p-3">
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-600 dark:text-zinc-300 md:text-sm">
                  {content}
                </p>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setEditing((current) => !current)}
                className="inline-flex items-center gap-1 text-[11px] text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-white"
              >
                <Pencil className="h-3 w-3" />
                {editing ? t('optimize.jdPreview') : t('optimize.jdEdit')}
              </button>
              {charCount > 0 && (
                <button
                  type="button"
                  onClick={onClear}
                  className="text-[11px] text-zinc-500 transition-colors hover:text-red-600"
                >
                  {t('optimize.clearJd')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}