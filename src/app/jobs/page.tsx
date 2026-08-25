'use client';

import { useState, useEffect, useCallback, useRef, type ComponentType, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTrigger,
  SheetTitle,
} from '@/components/ui/sheet';
import { Search, MapPin, Briefcase, Building2, Users, SlidersHorizontal, RotateCcw, ExternalLink, ChevronLeft, ChevronRight, X, Plus, Check, Loader2, Heart, Sparkles, Calendar } from 'lucide-react';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth-guard';
import { apiFetch } from '@/lib/api-client';
import { Header1 } from '@/components/header1';
import { useLanguage } from '@/lib/language-context';
import { getJobDeadlineRemaining } from '@/lib/job-deadline';

interface Job {
  id: number;
  title: string;
  company: string;
  region: string;
  direction: string;
  audience: string;
  description: string;
  requirements: string;
  salary_range: string;
  job_url: string;
  logo_url?: string;
  logo_fallback_url?: string;
  sponsorship?: 'yes' | 'no' | 'unknown';
  valid_through?: string | null;
  is_active?: boolean;
  created_at: string;
  updated_at?: string;
}

function getDeadlineDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value.trim();
  const dateOnly = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timestamp = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 23, 59, 59, 999).getTime()
    : Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function formatDeadline(value: string | null | undefined): string | null {
  const date = getDeadlineDate(value);
  return date
    ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }).format(date)
    : null;
}

function formatDeadlineRemaining(value: string | null | undefined, now: number, t: (key: string, params?: Record<string, string | number>) => string): string | null {
  if (!now) return null;
  const remaining = getJobDeadlineRemaining(value, now);
  if (!remaining) return null;
  if (remaining.expired) return t('jobs.deadlineExpired');
  return t('jobs.daysLeft', { days: remaining.days });
}

interface JobConfig {
  id: number;
  config_type: string;
  config_value: string;
  sort_order: number;
  is_active: boolean;
}

interface CompanyOption {
  company_name: string;
  logo_url: string | null;
  fallback_logo_url: string | null;
  job_count: number;
}

// 获取公司首字母
function getCompanyInitial(company: string): string {
  // 处理中文公司名
  if (/[\u4e00-\u9fa5]/.test(company)) {
    return company.charAt(0);
  }
  // 处理英文公司名，取首字母大写
  const words = company.split(/[\s-]+/);
  if (words.length >= 2) {
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
  }
  return company.charAt(0).toUpperCase();
}

// 公司Logo组件
function CompanyLogo({ company, logoUrl, fallbackLogoUrl }: { company: string; logoUrl?: string; fallbackLogoUrl?: string }) {
  const [failedSource, setFailedSource] = useState<'primary' | 'fallback' | null>(null);

  useEffect(() => {
    setFailedSource(null);
  }, [logoUrl, fallbackLogoUrl]);

  const logoSource = failedSource === 'primary'
    ? fallbackLogoUrl
    : failedSource === 'fallback'
      ? null
      : logoUrl;

  if (logoSource) {
    return (
      <div className="w-12 h-12 rounded-xl overflow-hidden bg-white border border-zinc-200 dark:border-zinc-700 flex-shrink-0">
        <img
          src={logoSource}
          alt={company}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="w-full h-full object-contain p-1"
          onError={() => {
            setFailedSource(logoSource === logoUrl && fallbackLogoUrl ? 'primary' : 'fallback');
          }}
        />
      </div>
    );
  }

  // Logo unavailable or failed: use a stable company initial placeholder.
  return (
    <div className="w-12 h-12 rounded-xl bg-zinc-900 dark:bg-white flex items-center justify-center flex-shrink-0 shadow-lg shadow-zinc-900/15 dark:shadow-black/30">
      <span className="text-white dark:text-zinc-900 font-bold text-lg">
        {getCompanyInitial(company)}
      </span>
    </div>
  );
}

// 大地区选项（用于筛选）
const mainRegions = [
  { id: -7, config_type: 'region', config_value: '北美', sort_order: 1, is_active: true },
  { id: -1, config_type: 'region', config_value: '美国', sort_order: 2, is_active: true },
  { id: -2, config_type: 'region', config_value: '英国', sort_order: 3, is_active: true },
  { id: -3, config_type: 'region', config_value: '加拿大', sort_order: 4, is_active: true },
  { id: -4, config_type: 'region', config_value: '澳大利亚', sort_order: 5, is_active: true },
  { id: -6, config_type: 'region', config_value: '香港', sort_order: 6, is_active: true },
  { id: -8, config_type: 'region', config_value: '新加坡', sort_order: 7, is_active: true },
];

const TARGET_REGION_LABELS = new Set(mainRegions.map((region) => region.config_value));

const jobTypeOptions: JobConfig[] = [
  { id: -101, config_type: 'job_type', config_value: '实习', sort_order: 1, is_active: true },
  { id: -102, config_type: 'job_type', config_value: '校招', sort_order: 2, is_active: true },
  { id: -103, config_type: 'job_type', config_value: '社招', sort_order: 3, is_active: true },
];

const sponsorshipOptions: JobConfig[] = [
  { id: -111, config_type: 'sponsorship', config_value: 'yes', sort_order: 1, is_active: true },
  { id: -112, config_type: 'sponsorship', config_value: 'no', sort_order: 2, is_active: true },
  { id: -113, config_type: 'sponsorship', config_value: 'unknown', sort_order: 3, is_active: true },
];

// 获取地区对应的显示文本
function getRegionDisplayText(region: string): string {
  return region;
}

// Keep each page varied without changing the order of jobs within a company.
// The hash makes the company rotation stable across renders while changing it
// between pages, so React never reshuffles cards during an unrelated update.
function diversifyJobs(jobs: Job[], page: number): Job[] {
  const buckets = new Map<string, Job[]>();

  for (const job of jobs) {
    const company = job.company.trim() || `job-${job.id}`;
    const bucket = buckets.get(company);
    if (bucket) bucket.push(job);
    else buckets.set(company, [job]);
  }

  const companyNames = [...buckets.keys()].sort((a, b) => {
    const hash = (value: string) => {
      let result = 2166136261 ^ page;
      for (let index = 0; index < value.length; index += 1) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 16777619);
      }
      return result >>> 0;
    };
    return hash(a) - hash(b);
  });

  const diversified: Job[] = [];
  let hasJobs = true;
  while (hasJobs) {
    hasJobs = false;
    for (const company of companyNames) {
      const nextJob = buckets.get(company)?.shift();
      if (nextJob) {
        diversified.push(nextJob);
        hasJobs = true;
      }
    }
  }

  return diversified;
}

function FilterSection({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
        <Icon className="h-4 w-4 text-zinc-400" />
        {label}
      </h2>
      {children}
    </section>
  );
}

function CheckboxOptions({
  options,
  selected,
  onChange,
}: {
  options: JobConfig[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const toggle = (value: string) => {
    onChange(selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value]);
  };

  if (options.length === 0) {
    return <p className="text-sm text-zinc-400">暂无可用选项</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {options.map((option) => (
        <label
          key={option.id}
          className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          translate="no"
        >
          <Checkbox
            checked={selected.includes(option.config_value)}
            onCheckedChange={() => toggle(option.config_value)}
          />
          <span className="truncate">{getRegionDisplayText(option.config_value)}</span>
        </label>
      ))}
    </div>
  );
}

function RadioOptions({
  value,
  options,
  allLabel,
  onChange,
  formatValue = (item) => item,
}: {
  value: string;
  options: JobConfig[];
  allLabel: string;
  onChange: (value: string) => void;
  formatValue?: (value: string) => string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant={!value || value === allLabel ? 'default' : 'outline'}
        size="sm"
        onClick={() => onChange('')}
      >
        {allLabel}
      </Button>
      {options.map((option) => (
        <Button
          key={option.id}
          type="button"
          variant={value === option.config_value ? 'default' : 'outline'}
          size="sm"
          onClick={() => onChange(option.config_value)}
          translate="no"
        >
          {formatValue(option.config_value)}
        </Button>
      ))}
    </div>
  );
}

function BrandOptions({
  options,
  selected,
  search,
  loading,
  onSearchChange,
  onChange,
  t,
}: {
  options: CompanyOption[];
  selected: string[];
  search: string;
  loading: boolean;
  onSearchChange: (value: string) => void;
  onChange: (values: string[]) => void;
  t: (key: string) => string;
}) {
  const toggle = (company: string) => {
    onChange(selected.includes(company)
      ? selected.filter((item) => item !== company)
      : [...selected, company]);
  };

  const normalizedSearch = search.trim().toLowerCase();
  const matchingOptions = options.filter((option) =>
    !normalizedSearch || option.company_name.toLowerCase().includes(normalizedSearch),
  );
  const selectedOptions = options.filter((option) => selected.includes(option.company_name));
  const visibleOptions = [...selectedOptions, ...matchingOptions.filter((option) => !selected.includes(option.company_name))].slice(0, 120);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t('jobs.companySearchPlaceholder')}
          className="h-10 border-zinc-200 pl-9 dark:border-zinc-700"
        />
      </div>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />{t('jobs.companyLoading')}
        </div>
      ) : visibleOptions.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-400">{t('jobs.companyNoMatch')}</p>
      ) : (
        <div className="grid max-h-[22rem] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {visibleOptions.map((option) => {
            const checked = selected.includes(option.company_name);
            return (
              <button
                key={option.company_name}
                type="button"
                aria-pressed={checked}
                onClick={() => toggle(option.company_name)}
                className={`flex min-w-0 items-center gap-3 rounded-xl border p-2.5 text-left transition-all ${
                  checked
                    ? 'border-zinc-900 bg-zinc-900 text-white shadow-sm dark:border-white dark:bg-white dark:text-zinc-900'
                    : 'border-zinc-200 bg-white hover:border-zinc-400 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600'
                }`}
              >
                <CompanyLogo
                  company={option.company_name}
                  logoUrl={option.logo_url || undefined}
                  fallbackLogoUrl={option.fallback_logo_url || undefined}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{option.company_name}</span>
                  <span className={`block text-xs ${checked ? 'text-white/70 dark:text-zinc-500' : 'text-zinc-400'}`}>
                    {option.job_count} {t('jobs.jobsUnit')}
                  </span>
                </span>
                {checked && <Check className="h-4 w-4 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
      {matchingOptions.length > visibleOptions.length && (
        <p className="text-xs text-zinc-400">{t('jobs.companySearchHint')}</p>
      )}
    </div>
  );
}

// 内部组件
function JobsContent() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 30;
  const [totalJobs, setTotalJobs] = useState(0);
  const [totalJobsIsEstimate, setTotalJobsIsEstimate] = useState(false);
  const [hasMoreJobs, setHasMoreJobs] = useState(false);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedDirections, setSelectedDirections] = useState<string[]>([]);
  const [selectedJobType, setSelectedJobType] = useState('');
  const [selectedSponsorship, setSelectedSponsorship] = useState('');
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftRegions, setDraftRegions] = useState<string[]>([]);
  const [draftDirections, setDraftDirections] = useState<string[]>([]);
  const [draftJobType, setDraftJobType] = useState('');
  const [draftSponsorship, setDraftSponsorship] = useState('');
  const [draftCompanies, setDraftCompanies] = useState<string[]>([]);
  const [brandSearch, setBrandSearch] = useState('');
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([]);
  const [companyOptionsLoading, setCompanyOptionsLoading] = useState(true);
  const [companyOptionsLoaded, setCompanyOptionsLoaded] = useState(false);
  const [applyingJobId, setApplyingJobId] = useState<number | null>(null);
  const [appliedJobIds, setAppliedJobIds] = useState<Set<number>>(new Set());
  const [favoriteJobIds, setFavoriteJobIds] = useState<Set<number>>(new Set());
  const [favoriteLoadingJobId, setFavoriteLoadingJobId] = useState<number | null>(null);
  const [deadlineNow, setDeadlineNow] = useState(0);
  
  // 动态配置
  const [configs, setConfigs] = useState<{
    region: JobConfig[];
    direction: JobConfig[];
    audience: JobConfig[];
  }>({ region: [], direction: [], audience: [] });
  const jobsRequestIdRef = useRef(0);
  const previousFilterKeyRef = useRef<string | null>(null);

  const { t } = useLanguage();

  useEffect(() => {
    setDeadlineNow(Date.now());
    const timer = window.setInterval(() => setDeadlineNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (filterOpen) {
      setDraftRegions(selectedRegions);
      setDraftDirections(selectedDirections);
      setDraftJobType(selectedJobType);
      setDraftSponsorship(selectedSponsorship);
      setDraftCompanies(selectedCompanies);
    }
  }, [filterOpen, selectedRegions, selectedDirections, selectedJobType, selectedSponsorship, selectedCompanies]);

  const clearFilters = useCallback(() => {
    setSelectedRegions([]);
    setSelectedDirections([]);
    setSelectedJobType('');
    setSelectedSponsorship('');
    setSelectedCompanies([]);
    setPage(0);
  }, []);

  const applyDraftFilters = () => {
    setSelectedRegions(draftRegions);
    setSelectedDirections(draftDirections);
    setSelectedJobType(draftJobType);
    setSelectedSponsorship(draftSponsorship);
    setSelectedCompanies(draftCompanies);
    setPage(0);
    setFilterOpen(false);
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => window.clearTimeout(timeoutId);
  }, [searchTerm]);

  const activeFilterCount = selectedRegions.length
    + selectedDirections.length
    + (selectedJobType ? 1 : 0)
    + (selectedSponsorship ? 1 : 0)
    + selectedCompanies.length;

  const activeFilterSummaries = [
    selectedRegions.length > 0 ? { id: 'region', label: `${t('jobs.region')}: ${selectedRegions.join(', ')}` } : null,
    selectedDirections.length > 0 ? { id: 'direction', label: `${t('jobs.direction')}: ${selectedDirections.join(', ')}` } : null,
    selectedCompanies.length > 0 ? { id: 'company', label: `${t('jobs.company')}: ${selectedCompanies.join(', ')}` } : null,
    selectedJobType ? { id: 'job-type', label: `${t('jobs.jobType')}: ${selectedJobType}` } : null,
    selectedSponsorship ? {
      id: 'sponsorship',
      label: `${t('jobs.sponsorship')}: ${selectedSponsorship === 'yes' ? t('jobs.sponsorshipYes') : selectedSponsorship === 'no' ? t('jobs.sponsorshipNo') : t('jobs.sponsorshipUnknown')}`,
    } : null,
  ].filter((summary): summary is { id: string; label: string } => summary !== null);

  const fetchJobs = useCallback(async (options: { background?: boolean } = {}) => {
    const background = options.background === true;
    const requestId = ++jobsRequestIdRef.current;
    if (!background) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedRegions.length > 0) {
        selectedRegions.forEach(r => params.append('region', r));
      }
      if (selectedDirections.length > 0) {
        selectedDirections.forEach(d => params.append('direction', d));
      }
      if (selectedCompanies.length > 0) {
        selectedCompanies.forEach(company => params.append('company_exact', company));
      }
      if (selectedJobType) params.append('job_type', selectedJobType);
      if (selectedSponsorship) params.append('sponsorship', selectedSponsorship);
      if (debouncedSearchTerm.trim()) params.set('search', debouncedSearchTerm.trim());
      params.set('diverse', '1');
      params.set('summary', '1');
      params.set('limit', String(pageSize));
      params.set('offset', String(page * pageSize));

      const response = await apiFetch(`/api/jobs?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json();
      if (requestId !== jobsRequestIdRef.current) return;
      setJobs(data.jobs || []);
      setTotalJobs(data.pagination?.total || 0);
      setTotalJobsIsEstimate(Boolean(data.pagination?.total_is_estimate));
      setHasMoreJobs(Boolean(data.pagination?.has_more));
    } catch (error) {
      if (requestId !== jobsRequestIdRef.current) return;
      console.error('Failed to fetch jobs:', error);
    } finally {
      if (requestId === jobsRequestIdRef.current) setLoading(false);
    }
  }, [page, pageSize, debouncedSearchTerm, selectedRegions, selectedDirections, selectedCompanies, selectedJobType, selectedSponsorship]);

  const activeFilterKey = JSON.stringify([
    debouncedSearchTerm,
    selectedRegions,
    selectedDirections,
    selectedCompanies,
    selectedJobType,
    selectedSponsorship,
  ]);

  useEffect(() => {
    const filtersChanged = previousFilterKeyRef.current !== null
      && previousFilterKeyRef.current !== activeFilterKey;
    previousFilterKeyRef.current = activeFilterKey;
    if (filtersChanged && page !== 0) {
      setPage(0);
      return;
    }
    void fetchJobs();
  }, [activeFilterKey, fetchJobs, page]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [page]);

  // 获取已投递的岗位ID列表
  const fetchAppliedJobIds = useCallback(async () => {
    try {
      const response = await apiFetch('/api/applications');
      const data = await response.json();
      const ids = new Set<number>((data.applications || []).map((app: { job_id: number }) => app.job_id));
      setAppliedJobIds(ids);
    } catch (error) {
      console.error('Failed to fetch applied job ids:', error);
    }
  }, []);

  const fetchFavoriteJobIds = useCallback(async () => {
    try {
      const response = await apiFetch('/api/favorites');
      if (!response.ok) return;
      const data = await response.json();
      const ids = new Set<number>((data.favorites || []).map((favorite: { job_id: number }) => favorite.job_id));
      setFavoriteJobIds(ids);
    } catch (error) {
      console.error('Failed to fetch favorite job ids:', error);
    }
  }, []);

  useEffect(() => {
    // 获取配置。筛选变化只触发岗位请求，不重复拉取静态配置。
    apiFetch('/api/configs')
      .then(res => res.json())
      .then(data => {
        // 合并大地区选项和具体地区选项
        // The API is scoped to the five supported markets. Filter legacy
        // configuration rows as well so stale Europe/Asia options cannot
        // reappear in the client after a config refresh.
        const regionConfigs = (data.configs?.region || []).filter((region: JobConfig) =>
          TARGET_REGION_LABELS.has(region.config_value),
        );
        // 去重：大地区选项优先
        const existingMainRegions = regionConfigs.filter(
          (r: JobConfig) => mainRegions.some(mr => mr.config_value === r.config_value)
        );
        if (existingMainRegions.length === 0) {
          setConfigs({
            ...data.configs,
            region: [...mainRegions, ...regionConfigs]
          });
        } else {
          setConfigs({
            ...(data.configs || {}),
            region: [...mainRegions, ...regionConfigs.filter(
              (region: JobConfig) => !mainRegions.some((main) => main.config_value === region.config_value),
            )],
          });
        }
      })
      .catch(console.error);
    fetchAppliedJobIds();
    fetchFavoriteJobIds();
  }, [fetchAppliedJobIds, fetchFavoriteJobIds]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void fetchJobs({ background: true });
    };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [fetchJobs]);

  useEffect(() => {
    if (!filterOpen || companyOptionsLoaded) return;
    let cancelled = false;
    setCompanyOptionsLoading(true);
    apiFetch('/api/jobs/companies')
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setCompanyOptions(data.companies || []);
      })
      .catch((error) => {
        console.error('Failed to fetch company options:', error);
        if (!cancelled) setCompanyOptions([]);
      })
      .finally(() => {
        if (!cancelled) {
          setCompanyOptionsLoading(false);
          setCompanyOptionsLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [companyOptionsLoaded, filterOpen]);

  const handleFavorite = async (jobId: number) => {
    const isFavorite = favoriteJobIds.has(jobId);
    setFavoriteLoadingJobId(jobId);
    try {
      const response = await apiFetch('/api/favorites', {
        method: isFavorite ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId }),
      });
      const data = await response.json();
      if (!response.ok) {
        alert(data.error || t('jobs.favoriteFailed'));
        return;
      }
      setFavoriteJobIds((current) => {
        const next = new Set(current);
        if (isFavorite) next.delete(jobId);
        else next.add(jobId);
        return next;
      });
    } catch (error) {
      console.error('Failed to update favorite:', error);
      alert(t('jobs.favoriteRetry'));
    } finally {
      setFavoriteLoadingJobId(null);
    }
  };

  // 添加到网申管理
  const handleAdd = async (jobId: number) => {
    if (appliedJobIds.has(jobId)) {
      return;
    }

    setApplyingJobId(jobId);
    try {
      const response = await apiFetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: jobId,
          status: 'pending',
          notes: '',
        }),
      });
      
      const data = await response.json();
      
      if (data.application) {
        setAppliedJobIds(new Set([...appliedJobIds, jobId]));
      } else if (data.error) {
        alert(t('jobs.addFailed') + ': ' + data.error);
      }
    } catch (error) {
      console.error('Failed to add:', error);
      alert(t('jobs.addFailedRetry'));
    } finally {
      setApplyingJobId(null);
    }
  };

  const filteredJobs = diversifyJobs(jobs, page);

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <Header1 />
      <main className="relative container mx-auto px-4 pt-20 pb-16 sm:px-6 md:pt-24">
        {/* Hero：左对齐 eyebrow + 大标题（Tailark 式） */}
        <div className="relative mb-8 max-w-3xl md:mb-10">
          <p className="text-sm font-medium text-zinc-400 dark:text-zinc-500 mb-3">{t('page.jobs.eyebrow')}</p>
          <h1 className="break-words text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 md:text-4xl mb-4">{t('page.jobs.title')}</h1>
          <p className="text-zinc-500 dark:text-zinc-400 max-w-2xl md:text-lg leading-relaxed">{t('page.jobs.subtitle')}</p>
          <Link href="/ai-match" className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white">
            <Sparkles className="h-4 w-4 text-amber-500" />
            {t('jobs.aiMatchHint')}
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>

        {/* Filters */}
        <Card className="relative mb-4 md:mb-6 rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none bg-white dark:bg-zinc-950">
          <CardContent className="pt-4 pb-4 md:pt-5 md:pb-5">
            <div className="flex flex-col gap-3 md:gap-4">
              {/* 搜索框 */}
              <div className="relative w-full md:max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
                <Input
                  placeholder={t('jobs.searchPlaceholder')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 h-10 md:h-11 border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus-visible:ring-zinc-300 dark:focus-visible:ring-zinc-600"
                />
              </div>
              
              {/* 集中筛选入口：草稿条件在点击应用前不会触发请求 */}
              <div className="flex flex-wrap items-center gap-2 md:gap-3">
                <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
                  <SheetTrigger asChild>
                    <Button type="button" variant="outline" className="h-10 rounded-xl border-zinc-200 px-3 text-sm dark:border-zinc-700">
                      <SlidersHorizontal className="mr-2 h-4 w-4" />
                      {t('jobs.filter')}
                      {activeFilterCount > 0 && (
                        <Badge className="ml-2 rounded-full bg-zinc-900 px-1.5 text-[10px] text-white dark:bg-white dark:text-zinc-900">
                          {activeFilterCount}
                        </Badge>
                      )}
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="right" className="w-full border-zinc-200 p-0 dark:border-zinc-800 sm:max-w-md">
                    <SheetHeader className="border-b border-zinc-100 px-5 py-5 text-left dark:border-zinc-800">
                      <SheetTitle className="flex items-center gap-2 text-lg"><SlidersHorizontal className="h-5 w-5" />{t('jobs.filterTitle')}</SheetTitle>
                      <SheetDescription>{t('jobs.filterDescription')}</SheetDescription>
                    </SheetHeader>
                    <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
                      <FilterSection label={t('jobs.region')} icon={MapPin}>
                        <CheckboxOptions options={configs.region || []} selected={draftRegions} onChange={setDraftRegions} />
                      </FilterSection>
                      <FilterSection label={t('jobs.direction')} icon={Briefcase}>
                        <CheckboxOptions options={configs.direction || []} selected={draftDirections} onChange={setDraftDirections} />
                      </FilterSection>
                      <FilterSection label={t('jobs.company')} icon={Building2}>
                        <BrandOptions
                          options={companyOptions}
                          selected={draftCompanies}
                          search={brandSearch}
                          loading={companyOptionsLoading}
                          onSearchChange={setBrandSearch}
                          onChange={setDraftCompanies}
                          t={t}
                        />
                      </FilterSection>
                      <FilterSection label={t('jobs.jobType')} icon={Briefcase}>
                        <RadioOptions value={draftJobType} options={jobTypeOptions} allLabel={t('jobs.any')} onChange={setDraftJobType} />
                      </FilterSection>
                      <FilterSection label={t('jobs.sponsorship')} icon={Users}>
                        <RadioOptions value={draftSponsorship} options={sponsorshipOptions} allLabel={t('jobs.any')} onChange={setDraftSponsorship} formatValue={(value) => value === 'yes' ? t('jobs.sponsorshipYes') : value === 'no' ? t('jobs.sponsorshipNo') : t('jobs.sponsorshipUnknown')} />
                      </FilterSection>
                    </div>
                    <SheetFooter className="border-t border-zinc-100 px-5 py-4 dark:border-zinc-800 sm:flex-row sm:justify-between">
                      <Button type="button" variant="ghost" onClick={() => { setDraftRegions([]); setDraftDirections([]); setDraftJobType(''); setDraftSponsorship(''); setDraftCompanies([]); setBrandSearch(''); }}>
                        <RotateCcw className="mr-2 h-4 w-4" />{t('jobs.reset')}
                      </Button>
                      <Button type="button" onClick={applyDraftFilters} className="bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">{t('jobs.apply')}</Button>
                    </SheetFooter>
                  </SheetContent>
                </Sheet>
                {activeFilterCount > 0 && (
                  <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">
                    <X className="h-3 w-3" />{t('jobs.clearAll')}
                  </button>
                )}
              </div>
              {activeFilterSummaries.length > 0 && (
                <div className="flex flex-wrap gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                  {activeFilterSummaries.map((summary) => (
                    <Badge key={summary.id} variant="secondary" className="max-w-full rounded-md bg-zinc-100 px-2 py-1 text-xs font-normal text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      <span className="truncate">{summary.label}</span>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <div className="relative space-y-3 md:space-y-4">
          {loading ? (
            <div className="text-center py-12 text-zinc-400">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
              {t('jobs.loading')}
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 py-14 text-center text-zinc-400">
              <Briefcase className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">{t('jobs.noJobs')}</p>
            </div>
          ) : (
            filteredJobs.map((job) => (
              <Card key={job.id} className="rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none hover:shadow-xl hover:shadow-zinc-900/[0.06] dark:hover:shadow-black/30 transition-shadow duration-300 bg-white dark:bg-zinc-950">
                <CardContent className="pt-3 md:pt-4 pb-3">
                  <div className="flex gap-3 md:gap-4">
                    {/* 左侧内容区 */}
                    <div className="flex-1 min-w-0 flex flex-col gap-2 md:gap-3">
                      {/* 岗位信息 - 横向布局 */}
                      <div className="flex items-start gap-3 md:gap-4">
                        <CompanyLogo company={job.company} logoUrl={job.logo_url} fallbackLogoUrl={job.logo_fallback_url} />
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold tracking-tight text-base md:text-lg text-zinc-900 dark:text-zinc-50 line-clamp-1">
                            {job.title}
                          </h3>
                          <p className="text-sm text-zinc-500 dark:text-zinc-400 truncate">{job.company}</p>
                        </div>
                      </div>

                      {/* 标签区 */}
                      <div className="flex flex-wrap gap-1.5 md:gap-2">
                        <Badge variant="secondary" className="rounded-md text-xs bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 hover:bg-zinc-100" translate="no">
                          <MapPin className="h-3 w-3 mr-1" />
                          {getRegionDisplayText(job.region)}
                        </Badge>
                        <Badge variant="secondary" className="rounded-md text-xs bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 hover:bg-zinc-100" translate="no">
                          <Briefcase className="h-3 w-3 mr-1" />
                          {job.direction}
                        </Badge>
                        <Badge variant="secondary" className="rounded-md text-xs bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 hover:bg-zinc-100" translate="no">
                          <Users className="h-3 w-3 mr-1" />
                          {job.audience}
                        </Badge>
                        {job.salary_range && (
                          <Badge variant="outline" className="border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-md text-xs">
                            {job.salary_range}
                          </Badge>
                        )}
                        {job.sponsorship && job.sponsorship !== 'unknown' && (
                          <Badge
                            variant="outline"
                            className="rounded-md text-xs border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300"
                          >
                            {job.sponsorship === 'yes' ? t('jobs.sponsor') : t('jobs.noSponsor')}
                          </Badge>
                        )}
                        {formatDeadline(job.valid_through) && (
                          <Badge variant="outline" className="border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-md text-xs">
                            <Calendar className="h-3 w-3 mr-1" />
                            {t('jobs.deadline')} {formatDeadline(job.valid_through)}
                          </Badge>
                        )}
                        {job.is_active === false ? (
                          <Badge variant="secondary" className="bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500 rounded-md text-xs hover:bg-zinc-100">
                            {t('jobs.inactive')}
                          </Badge>
                        ) : (
                          <Badge variant="default" className="bg-zinc-900 dark:bg-white dark:text-zinc-900 rounded-md text-xs hover:bg-zinc-900">
                            {t('jobs.active')}
                          </Badge>
                        )}
                      </div>

                      {/* 描述 */}
                      {job.description && (
                        <p className="text-xs md:text-sm text-zinc-400 dark:text-zinc-500 line-clamp-2">
                          {job.description}
                        </p>
                      )}
                      {formatDeadlineRemaining(job.valid_through, deadlineNow, t) && (
                        <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                          {formatDeadlineRemaining(job.valid_through, deadlineNow, t)}
                        </p>
                      )}
                    </div>

                    {/* 右侧按钮区 - 垂直排列 */}
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        title={favoriteJobIds.has(job.id) ? t('jobs.favorited') : t('jobs.favorite')}
                        aria-label={favoriteJobIds.has(job.id) ? t('jobs.favorited') : t('jobs.favorite')}
                        onClick={() => handleFavorite(job.id)}
                        disabled={favoriteLoadingJobId === job.id}
                        className={favoriteJobIds.has(job.id)
                          ? 'text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/30'
                          : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'}
                      >
                        {favoriteLoadingJobId === job.id
                          ? <Loader2 className="animate-spin" />
                          : <Heart className={favoriteJobIds.has(job.id) ? 'fill-current' : ''} />}
                      </Button>
                      {job.is_active !== false && (
                        <Button
                          size="sm"
                          className="rounded-lg text-xs md:text-sm h-9 w-24 md:w-28 bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                          onClick={() => handleAdd(job.id)}
                          disabled={applyingJobId === job.id || appliedJobIds.has(job.id)}
                        >
                          {applyingJobId === job.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : appliedJobIds.has(job.id) ? (
                            <>
                              <Check className="h-3.5 w-3.5 mr-1" />
                              {t('jobs.added')}
                            </>
                          ) : (
                            <>
                              <Plus className="h-3.5 w-3.5 mr-1" />
                              {t('jobs.add')}
                            </>
                          )}
                        </Button>
                      )}
                      <Button size="sm" variant="outline" asChild className="rounded-lg text-xs md:text-sm h-9 whitespace-nowrap border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                        <Link href={`/jobs/${job.id}`}>
                          {t('jobs.viewDetail')}
                        </Link>
                      </Button>
                      {job.job_url && (
                        <Button size="sm" variant="outline" asChild className="rounded-lg text-xs md:text-sm h-9 whitespace-nowrap border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                          <a href={`/api/jobs/${job.id}/open`} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3.5 w-3.5 mr-1 flex-shrink-0" />
                            {t('jobs.originalLink')}
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Results count */}
        {!loading && totalJobs > 0 && (
          <div className="relative mt-4 md:mt-6 flex flex-col items-center gap-3 text-xs md:text-sm text-zinc-400 dark:text-zinc-500">
            <span>{t('jobs.foundJobs')} {totalJobsIsEstimate ? '约 ' : ''}{totalJobs} {t('jobs.jobsUnit')} · {t('jobs.page')} {page + 1}</span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                disabled={page === 0 || loading}
                aria-label={t('jobs.previous')}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />{t('jobs.previous')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPage((current) => current + 1)}
                disabled={loading || !hasMoreJobs}
                aria-label={t('jobs.next')}
              >
                {t('jobs.next')}<ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// 导出默认函数
export default function JobsPage() {
  return (
    <AuthGuard>
      <JobsContent />
    </AuthGuard>
  );
}
