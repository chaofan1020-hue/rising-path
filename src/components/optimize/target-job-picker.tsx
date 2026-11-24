'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ChevronDown,
  ChevronRight,
  Link2,
  Loader2,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useLanguage } from '@/lib/language-context';

export interface TargetJobOption {
  id: number;
  title: string;
  company: string;
  region: string;
}

interface TargetJobPickerProps {
  /** 收藏岗位（来自 /api/optimize/job-options） */
  favorites: TargetJobOption[];
  /** 已添加/投递过的岗位 */
  applications: TargetJobOption[];
  /** 当前锚定的站内岗位；null 表示未选，走手动填写 */
  selectedJob: TargetJobOption | null;
  /** 该岗位的 JD 是否正在读取 */
  jdFetching: boolean;
  /** 已拿到的 JD 字符数，用于「已关联 JD · N 字」徽标 */
  jdCharCount: number;
  manualCompany: string;
  manualPosition: string;
  /** JD 请求进行中时禁用「补全 JD」按钮 */
  fetchJdDisabled: boolean;
  onSelect: (job: TargetJobOption) => void;
  onClear: () => void;
  onManualChange: (patch: { company?: string; position?: string }) => void;
  onFetchJd: () => void;
}

/**
 * 目标岗位选择器：收藏 / 已添加 / 全库搜索 / 手动填写 统一到一个入口。
 *
 * 选中站内岗位后收敛成一张卡片（含 JD 关联状态），避免下方再出现一套
 * 目标公司/目标岗位输入框与它互相覆盖。
 */
export function TargetJobPicker({
  favorites,
  applications,
  selectedJob,
  jdFetching,
  jdCharCount,
  manualCompany,
  manualPosition,
  fetchJdDisabled,
  onSelect,
  onClear,
  onManualChange,
  onFetchJd,
}: TargetJobPickerProps) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TargetJobOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  // 已填了内容（例如从历史记录回填）时自动展开手动区
  const showManual = manualOpen || (!selectedJob && (manualCompany.trim() !== '' || manualPosition.trim() !== ''));

  useEffect(() => {
    const keyword = query.trim();
    if (keyword.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      apiFetch(`/api/jobs?search=${encodeURIComponent(keyword)}&limit=8&summary=1&region_scope=all`)
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || '搜索岗位失败');
          return (data.jobs || []) as TargetJobOption[];
        })
        .then((jobs) => {
          if (!cancelled) setResults(jobs);
        })
        .catch((error) => {
          if (!cancelled) {
            console.error('[target-job-picker] search failed:', error);
            setResults([]);
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setManualOpen(true);
    onClear();
  };

  const handleSelect = (job: TargetJobOption) => {
    setQuery('');
    setResults([]);
    setManualOpen(false);
    onSelect(job);
  };

  return (
    <section aria-labelledby="target-job-heading">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-[11px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          1
        </span>
        <span
          id="target-job-heading"
          className="text-xs font-medium text-zinc-900 md:text-sm dark:text-zinc-100"
        >
          {t('optimize.targetJobTitle')}
        </span>
        <span className="text-xs text-red-500" aria-hidden="true">*</span>
        {selectedJob && (
          <button
            type="button"
            onClick={handleClear}
            className="ml-auto text-xs text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-white"
          >
            {t('optimize.clearSelection')}
          </button>
        )}
      </div>

      {selectedJob ? (
        <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3.5 py-3 dark:border-zinc-800 dark:bg-zinc-950">
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {selectedJob.title || selectedJob.company || '—'}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
              <span className="truncate">
                {[selectedJob.company, selectedJob.region].filter(Boolean).join(' · ') || '—'}
              </span>
              {jdFetching ? (
                <span className="inline-flex items-center gap-1 text-zinc-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t('optimize.jdFetching')}
                </span>
              ) : jdCharCount > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <Link2 className="h-3 w-3" />
                  {t('optimize.jdAutoLinked', { count: jdCharCount })}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                  {t('optimize.jobSelectedNoJd')}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClear}
            aria-label={t('optimize.clearSelection')}
            className="shrink-0 rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          {favorites.length > 0 && (
            <div className="mb-2.5">
              <p className="mb-1.5 text-[11px] font-medium text-zinc-500">{t('optimize.myFavorites')}</p>
              <div className="flex flex-wrap gap-1.5">
                {favorites.slice(0, 6).map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => handleSelect(job)}
                    className="max-w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-left text-xs text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <span className="block truncate font-medium">{job.title}</span>
                    <span className="mt-0.5 block truncate text-[11px] opacity-60">{job.company}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {applications.length > 0 && (
            <div className="mb-2.5">
              <p className="mb-1.5 text-[11px] font-medium text-zinc-500">{t('optimize.addedJobs')}</p>
              <div className="flex flex-wrap gap-1.5">
                {applications.slice(0, 6).map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => handleSelect(job)}
                    className="max-w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-left text-xs text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <span className="block truncate font-medium">{job.title}</span>
                    <span className="mt-0.5 block truncate text-[11px] opacity-60">{job.company}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-10 pl-9"
              placeholder={t('optimize.jobPickerPlaceholder')}
            />
            {(searching || results.length > 0) && (
              <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-950">
                {searching && (
                  <p className="px-3 py-2 text-xs text-zinc-500">{t('optimize.jobPickerSearching')}</p>
                )}
                {!searching && results.length === 0 && (
                  <p className="px-3 py-2 text-xs text-zinc-500">{t('optimize.jobPickerEmpty')}</p>
                )}
                {!searching && results.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => handleSelect(job)}
                    className="flex w-full items-center justify-between gap-3 rounded px-3 py-2.5 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{job.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-zinc-500">{job.company} · {job.region}</span>
                    </span>
                    <Plus className="h-4 w-4 shrink-0 text-zinc-400" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* 手动填写：站内没有这个岗位时的兜底，默认折叠 */}
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setManualOpen((open) => !open)}
          aria-expanded={showManual}
          className="inline-flex items-center gap-1 text-[11px] text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-white"
        >
          {showManual ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {t('optimize.manualToggle')}
        </button>
        {showManual && (
          <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-zinc-500" htmlFor="manual-company">
                  {t('optimize.manualCompany')}
                </label>
                <Input
                  id="manual-company"
                  value={manualCompany}
                  onChange={(event) => onManualChange({ company: event.target.value })}
                  placeholder={t('optimize.targetCompanyPlaceholder')}
                  className="h-9"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-zinc-500" htmlFor="manual-position">
                  {t('optimize.manualPosition')}
                </label>
                <Input
                  id="manual-position"
                  value={manualPosition}
                  onChange={(event) => onManualChange({ position: event.target.value })}
                  placeholder={t('optimize.targetPositionPlaceholder')}
                  className="h-9"
                />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-zinc-400">{t('optimize.manualHint')}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={onFetchJd}
                disabled={fetchJdDisabled || (!manualCompany.trim() && !manualPosition.trim())}
                className="h-8 shrink-0 text-xs"
              >
                {jdFetching ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="mr-1.5 h-3.5 w-3.5" />
                )}
                {t('optimize.jdFetchAction')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}