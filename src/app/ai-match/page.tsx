'use client';

import { useState, useEffect, useRef } from 'react';
import type { ResumeProfile, UserSegmentation } from '@/lib/resume-types';
import type { MatchExclusionCounts } from '@/lib/ai-match-candidate-ranking';
import { defaultMatchFilters, type MatchJobType, type SponsorshipFilter } from '@/lib/ai-match-filters';
import type { MatchRunSummary } from '@/lib/ai-match-session';
import {
  emptyMatchTeaser,
  MATCH_CREDIT_COST_FALLBACK,
  MATCH_REPORT_LIMIT,
  type MatchTeaser,
} from '@/lib/ai-match-teaser';
import { resolveDisplayLogoUrls } from '@/lib/company-logo';
import { localizeJobEnum } from '@/lib/job-display';
import { CompanyLogo } from '@/components/company-logo';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Loader2,
  Sparkles,
  MapPin,
  Compass,
  ChevronDown,
  Wand2,
  Briefcase,
  ShieldCheck,
  Mic,
  ArrowLeft,
  Lock,
  Coins,
} from 'lucide-react';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth-guard';
import { apiFetch } from '@/lib/api-client';
import { Header1 } from '@/components/header1';
import { useLanguage } from '@/lib/language-context';
import { useCreditPrices } from '@/hooks/use-credit-prices';
import PageBackButton from '@/components/page-back-button';
import { readActiveResumeId, writeActiveResumeId } from '@/lib/active-resume';
import { pickEligibleResumeId } from '@/lib/resume-availability';
import { useResumeAvailability } from '@/hooks/use-resume-availability';
import { ResumeAvailabilityHint } from '@/components/resume-availability-hint';

interface Resume {
  id: number;
  file_name: string;
  processing_status?: string;
  segmentation_confirmed?: boolean;
  profile_version?: number;
  profile?: ResumeProfile | null;
  segmentation?: UserSegmentation | null;
  user_info: {
    name?: string;
    skills?: string[];
  };
}

type MatchFeedbackValue = 'interested' | 'not_interested' | 'inaccurate';
type MatchStage = '' | 'retrieval' | 'ranking' | 'explaining' | 'complete';

interface MatchResult {
  job_id: number;
  job_title: string;
  company: string;
  role_fit?: 'direct' | 'adjacent';
  match_score: number;
  match_reason: string;
  suggestions: string;
  score_breakdown: Record<string, number>;
  evidence: string[];
  key_gaps: string[];
  resume_profile_version: number;
  recommendation_type?: 'apply_now' | 'improve_then_apply' | 'low_priority';
  confidence?: number;
  eligibility?: { status: 'eligible' | 'uncertain' | 'blocked'; reasons: string[] };
  field_quality?: Record<string, 'verified' | 'derived' | 'pending_recheck' | 'missing'>;
  region?: string | null;
  direction?: string | null;
  job_url?: string | null;
  salary_range?: string | null;
  sponsorship?: 'yes' | 'no' | 'unknown' | null;
  workplace_type?: string | null;
  valid_through?: string | null;
  analysis_source?: 'features' | 'model';
}

interface MatchResponse extends ApiErrorPayload {
  matches?: MatchResult[];
  teaser?: MatchTeaser;
  preview_jobs?: unknown[];
  candidate_count?: number;
  partial?: boolean;
  restored?: boolean;
  no_suitable_candidates?: boolean;
  excluded_candidate_count?: number;
  feedback_excluded_count?: number;
  match_summary?: MatchRunSummary | null;
  explained_count?: number;
  batch_count?: number;
  completed_batch_count?: number;
  failed_batch_count?: number;
  persistence_warning?: string | null;
}

interface JobConfig {
  id: number;
  config_type: string;
  config_value: string;
  sort_order: number;
  is_active: boolean;
}

type ApiErrorPayload = { error?: string | { message?: string } };

async function readApiJson<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.text();
  if (!body.trim()) throw new Error(`${fallback} (${response.status})`);
  try {
    return JSON.parse(body.replace(/^\uFEFF/, '')) as T;
  } catch {
    const contentType = response.headers.get('content-type') || '';
    const isHtml = contentType.includes('text/html') || /^\s*<!doctype\s+html/i.test(body);
    throw new Error(isHtml ? `${fallback} (${response.status})` : fallback);
  }
}

function getApiErrorMessage(payload: ApiErrorPayload | null, fallback: string): string {
  const apiError = payload?.error;
  if (typeof apiError === 'string' && apiError.trim()) return apiError;
  if (typeof apiError === 'object' && apiError !== null && typeof apiError.message === 'string' && apiError.message.trim()) {
    return apiError.message;
  }
  return fallback;
}

const FALLBACK_JOB_TYPES: JobConfig[] = [
  { id: -101, config_type: 'job_type', config_value: '实习', sort_order: 1, is_active: true },
  { id: -102, config_type: 'job_type', config_value: '校招', sort_order: 2, is_active: true },
  { id: -103, config_type: 'job_type', config_value: '社招', sort_order: 3, is_active: true },
];

function filterStorageKey(resumeId: string, version: number) {
  return `liorvix:ai-match:filters:${resumeId}:${version}`;
}

function readStoredFilters(resumeId: string, version: number): {
  regions: string[];
  directions: string[];
  jobTypes: MatchJobType[];
  sponsorship: SponsorshipFilter;
} | null {
  try {
    const raw = sessionStorage.getItem(filterStorageKey(resumeId, version));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const jobTypes = Array.isArray(parsed.jobTypes)
      ? parsed.jobTypes.filter((item): item is MatchJobType => item === '实习' || item === '校招' || item === '社招')
      : [];
    const sponsorship = parsed.sponsorship === 'any' || parsed.sponsorship === 'exclude_no' || parsed.sponsorship === 'require_yes'
      ? parsed.sponsorship
      : 'any';
    return {
      regions: Array.isArray(parsed.regions) ? parsed.regions.filter((item) => typeof item === 'string') : [],
      directions: Array.isArray(parsed.directions) ? parsed.directions.filter((item) => typeof item === 'string') : [],
      jobTypes,
      sponsorship,
    };
  } catch {
    return null;
  }
}

function writeStoredFilters(
  resumeId: string,
  version: number,
  filters: { regions: string[]; directions: string[]; jobTypes: MatchJobType[]; sponsorship: SponsorshipFilter },
) {
  try {
    sessionStorage.setItem(filterStorageKey(resumeId, version), JSON.stringify(filters));
  } catch {
    // Ignore quota or private-mode failures.
  }
}

const PREVIEW_CACHE_TTL_MS = 10 * 60 * 1000;

type MatchFilterSnapshot = {
  regions: string[];
  directions: string[];
  jobTypes: MatchJobType[];
  sponsorship: SponsorshipFilter;
};

function previewStorageKey(resumeId: string, version: number) {
  return `liorvix:ai-match:teaser:${resumeId}:${version}`;
}

function sameStringSet(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const other = new Set(right);
  return left.every((item) => other.has(item));
}

function sameMatchFilters(left: MatchFilterSnapshot, right: MatchFilterSnapshot) {
  return sameStringSet(left.regions, right.regions)
    && sameStringSet(left.directions, right.directions)
    && sameStringSet(left.jobTypes, right.jobTypes)
    && left.sponsorship === right.sponsorship;
}

function readPreviewCache(
  resumeId: string,
  version: number,
  filters: MatchFilterSnapshot,
): { teaser: MatchTeaser; summary: MatchRunSummary | null } | null {
  try {
    const raw = sessionStorage.getItem(previewStorageKey(resumeId, version));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      savedAt?: number;
      regions?: string[];
      directions?: string[];
      jobTypes?: MatchJobType[];
      sponsorship?: SponsorshipFilter;
      teaser?: MatchTeaser;
      match_summary?: MatchRunSummary | null;
    };
    if (!parsed.savedAt || Date.now() - parsed.savedAt > PREVIEW_CACHE_TTL_MS) return null;
    if (!parsed.teaser || typeof parsed.teaser !== 'object') return null;
    const cachedFilters: MatchFilterSnapshot = {
      regions: Array.isArray(parsed.regions) ? parsed.regions.filter((item) => typeof item === 'string') : [],
      directions: Array.isArray(parsed.directions) ? parsed.directions.filter((item) => typeof item === 'string') : [],
      jobTypes: Array.isArray(parsed.jobTypes)
        ? parsed.jobTypes.filter((item): item is MatchJobType => item === '实习' || item === '校招' || item === '社招')
        : [],
      sponsorship: parsed.sponsorship === 'any' || parsed.sponsorship === 'exclude_no' || parsed.sponsorship === 'require_yes'
        ? parsed.sponsorship
        : 'any',
    };
    if (!sameMatchFilters(filters, cachedFilters)) return null;
    return { teaser: parsed.teaser, summary: parsed.match_summary || null };
  } catch {
    return null;
  }
}

function writePreviewCache(
  resumeId: string,
  version: number,
  filters: MatchFilterSnapshot,
  teaser: MatchTeaser,
  summary: MatchRunSummary | null,
) {
  try {
    sessionStorage.setItem(previewStorageKey(resumeId, version), JSON.stringify({
      savedAt: Date.now(),
      ...filters,
      teaser,
      match_summary: summary,
    }));
  } catch {
    // Ignore quota or private-mode failures.
  }
}

type MatchStreamEvent =
  | { type: 'stage'; stage: MatchStage; current?: number; total?: number }
  | { type: 'ranked'; matches?: MatchResult[] }
  | { type: 'explanation'; match?: MatchResult }
  | { type: 'done'; payload?: MatchResponse }
  | { type: 'error'; error?: string };

async function readMatchStream(
  response: Response,
  onEvent: (event: MatchStreamEvent) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('stream-unavailable');
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';
    for (const chunk of chunks) {
      const line = chunk.split('\n').find((item) => item.startsWith('data: '));
      if (!line) continue;
      onEvent(JSON.parse(line.slice(6)) as MatchStreamEvent);
    }
  }
}

function formatDeadline(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function isHttpUrl(value?: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function optimizeHref(input: {
  resumeId: string;
  jobId: number;
  company: string;
  position: string;
  region?: string | null;
}): string {
  const params = new URLSearchParams({
    resumeId: input.resumeId,
    jobId: String(input.jobId),
    company: input.company,
    position: input.position,
  });
  if (input.region) params.set('region', input.region);
  return `/optimize?${params.toString()}`;
}

function interviewHref(input: {
  resumeId: string;
  jobId: number;
  company: string;
  position: string;
}): string {
  const params = new URLSearchParams({
    resumeId: input.resumeId,
    jobId: String(input.jobId),
    company: input.company,
    position: input.position,
  });
  return `/mock-interview?${params.toString()}`;
}

function exclusionDetails(
  exclusions: MatchExclusionCounts | undefined,
  locale: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!exclusions) return '';
  return [
    exclusions.sponsorship ? t('aiMatch.excludeSponsorship', { count: exclusions.sponsorship }) : '',
    exclusions.job_type ? t('aiMatch.excludeJobType', { count: exclusions.job_type }) : '',
    exclusions.experience ? t('aiMatch.excludeExperience', { count: exclusions.experience }) : '',
    exclusions.senior_title ? t('aiMatch.excludeSeniorTitle', { count: exclusions.senior_title }) : '',
    exclusions.feedback ? t('aiMatch.excludeFeedback', { count: exclusions.feedback }) : '',
  ].filter(Boolean).join(locale === 'en' ? ', ' : '、');
}

// 多选筛选器组件
function MultiSelectFilter({
  label,
  icon: Icon,
  options,
  selected,
  onChange,
  t,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  options: JobConfig[];
  selected: string[];
  onChange: (values: string[]) => void;
  t: (key: string) => string;
}) {
  const handleToggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter(v => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex h-10 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 text-sm text-zinc-700 transition-colors hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:text-zinc-50">
          <Icon className="h-3.5 w-3.5 md:h-4 md:w-4 text-zinc-400 dark:text-zinc-500" />
          <span className="font-medium">{label}</span>
          {selected.length > 0 && (
            <Badge variant="secondary" className="ml-0.5 h-4 md:h-5 px-1 md:px-1.5 rounded-full text-[10px] md:text-xs bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
              {selected.length}
            </Badge>
          )}
          <ChevronDown className="h-3 w-3 md:h-3.5 md:w-3.5 text-zinc-400 dark:text-zinc-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-44 md:w-48 p-2" align="start">
        <div className="max-h-60 overflow-y-auto space-y-1">
          {options.map((option) => (
            <div
              key={option.id}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
                selected.includes(option.config_value)
                  ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60'
              }`}
              onClick={() => handleToggle(option.config_value)}
              translate="no"
            >
              <Checkbox
                checked={selected.includes(option.config_value)}
                onCheckedChange={() => handleToggle(option.config_value)}
                onClick={(event) => event.stopPropagation()}
                className="data-[state=checked]:bg-zinc-900 data-[state=checked]:border-zinc-900 dark:data-[state=checked]:bg-white dark:data-[state=checked]:border-white dark:data-[state=checked]:text-zinc-900"
              />
              <span className="text-sm font-medium">{localizeJobEnum(option.config_value, t) || option.config_value}</span>
            </div>
          ))}
        </div>
        {options.length === 0 && (
          <div className="text-center py-2 text-sm text-zinc-400">{t('aiMatch.noOptions')}</div>
        )}
        {selected.length > 0 && (
          <div className="border-t border-zinc-100 dark:border-zinc-800 mt-2 pt-2">
            <button
              onClick={() => onChange([])}
              className="w-full text-xs text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors py-1"
            >
              {t('aiMatch.clearAll')}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function TeaserSkeleton() {
  return (
    <div className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="grid gap-8 p-6 md:grid-cols-[1.1fr_0.9fr] md:p-10">
        <div className="space-y-5">
          <div className="h-3 w-24 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
          <div className="h-16 w-28 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-4 w-48 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
          <div className="h-11 w-48 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
        </div>
        <div className="grid gap-3">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
          ))}
        </div>
      </div>
    </div>
  );
}

function LockedSampleCard({
  company,
  title,
  region,
  direction,
  onUnlock,
  t,
}: {
  company: string;
  title: string;
  region?: string | null;
  direction?: string | null;
  onUnlock: () => void;
  t: (key: string) => string;
}) {
  const logos = resolveDisplayLogoUrls(company);
  const meta = [region, direction].filter((item): item is string => Boolean(item && item.trim())).join(' · ');
  return (
    <button
      type="button"
      onClick={onUnlock}
      className="group relative w-full overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-zinc-400 hover:shadow-[0_20px_50px_-24px_rgba(24,24,27,0.35)] dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-500"
    >
      <div className="flex items-start gap-3">
        <CompanyLogo company={company} logoUrl={logos.logo_url} fallbackLogoUrl={logos.logo_fallback_url} size="md" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400">{company}</p>
          <p className="mt-1 truncate text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</p>
          {meta ? <p className="mt-1 truncate text-xs text-zinc-500">{meta}</p> : null}
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-1 text-[10px] font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
          <Lock className="h-3 w-3" />
          {t('aiMatch.teaserLocked')}
        </span>
      </div>
    </button>
  );
}

function ReportSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 2 }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-[28px] border border-zinc-200 p-6 dark:border-zinc-800 md:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="h-14 w-14 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
              <div className="space-y-2">
                <div className="h-3 w-24 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
                <div className="h-6 w-56 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                <div className="h-3 w-40 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
              </div>
            </div>
            <div className="h-12 w-12 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
          </div>
          <div className="mt-6 h-16 animate-pulse rounded-2xl bg-zinc-50 dark:bg-zinc-900" />
        </div>
      ))}
    </div>
  );
}

function MatchReportCard({
  result,
  featured,
  matching,
  favorite,
  tracked,
  feedback,
  busy,
  resumeId,
  decisionLabel,
  sponsorshipLabel,
  t,
  onFavorite,
  onTrack,
  onFeedback,
}: {
  result: MatchResult;
  featured: boolean;
  matching: boolean;
  favorite: boolean;
  tracked: boolean;
  feedback?: MatchFeedbackValue;
  busy: boolean;
  resumeId: string;
  decisionLabel: string;
  sponsorshipLabel: string;
  t: (key: string, params?: Record<string, string | number>) => string;
  onFavorite: () => void;
  onTrack: () => void;
  onFeedback: (value: MatchFeedbackValue) => void;
}) {
  const logos = resolveDisplayLogoUrls(result.company, result.job_url);
  const deadline = formatDeadline(result.valid_through);
  const meta = [
    result.region,
    result.role_fit === 'direct' ? t('aiMatch.targetRole') : result.role_fit === 'adjacent' ? t('aiMatch.adjacentRole') : '',
    sponsorshipLabel,
    deadline ? `${t('aiMatch.deadline')} ${deadline}` : '',
  ].filter((item): item is string => Boolean(item && item.trim()));
  const reason = result.match_reason || (matching ? t('aiMatch.explainingThisJob') : '');
  const evidence = (result.evidence || []).slice(0, 3);
  const gaps = (result.key_gaps || []).slice(0, 3);

  return (
    <article
      className={`group relative overflow-hidden border border-zinc-200 bg-white transition-all duration-300 hover:border-zinc-400 hover:shadow-[0_28px_80px_-36px_rgba(24,24,27,0.45)] dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-500 ${
        featured ? 'rounded-[28px] p-6 md:p-8' : 'rounded-2xl p-5 md:p-6'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <CompanyLogo
            company={result.company}
            logoUrl={logos.logo_url}
            fallbackLogoUrl={logos.logo_fallback_url}
            size={featured ? 'lg' : 'md'}
            className={featured ? 'rounded-2xl' : ''}
          />
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-400">{result.company}</p>
            <h3 className={`mt-1 font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 ${featured ? 'text-xl md:text-2xl' : 'text-base md:text-lg'}`}>
              <Link href={`/jobs/${result.job_id}`} className="hover:underline">{result.job_title}</Link>
            </h3>
            <p className="mt-1.5 text-xs text-zinc-500 md:text-sm">{meta.join(' · ')}</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`font-semibold tracking-tighter text-zinc-900 tabular-nums dark:text-zinc-50 ${featured ? 'text-4xl md:text-5xl' : 'text-2xl md:text-3xl'}`}>
            {result.match_score}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-zinc-400">{t('aiMatch.matchScore')}</div>
        </div>
      </div>

      <div className="mt-5">
        <span className="rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white dark:bg-white dark:text-zinc-900">{decisionLabel}</span>
      </div>

      <div className={`mt-5 ${featured ? 'border-l-2 border-zinc-900 pl-4 dark:border-white' : ''}`}>
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400">{t('aiMatch.whySelected')}</p>
        {reason ? (
          <p className={`mt-2 leading-relaxed text-zinc-700 dark:text-zinc-200 ${featured ? 'text-base md:text-lg' : 'text-sm'}`}>{reason}</p>
        ) : (
          <div className="mt-3 h-12 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
        )}
      </div>

      {(evidence.length > 0 || gaps.length > 0) && (
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {evidence.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400">{t('aiMatch.evidence')}</p>
              <ol className="mt-2 space-y-1.5">
                {evidence.map((item, index) => (
                  <li key={item} className="flex gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                    <span className="w-5 shrink-0 font-mono text-[11px] text-zinc-300">{String(index + 1).padStart(2, '0')}</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {gaps.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400">{t('aiMatch.keyGaps')}</p>
              <ol className="mt-2 space-y-1.5">
                {gaps.map((item, index) => (
                  <li key={item} className="flex gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                    <span className="w-5 shrink-0 font-mono text-[11px] text-zinc-300">{String(index + 1).padStart(2, '0')}</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {result.suggestions ? (
        <p className="mt-5 text-sm leading-6 text-zinc-500">{result.suggestions}</p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
        {isHttpUrl(result.job_url) && (
          <Button size="sm" asChild className="h-9 rounded-full bg-zinc-900 px-4 text-xs text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
            <a href={result.job_url || undefined} target="_blank" rel="noopener noreferrer">
              {t('aiMatch.applyOfficial')}
            </a>
          </Button>
        )}
        <Button size="sm" variant="outline" asChild className="h-9 rounded-full border-zinc-200 text-xs hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
          <Link href={optimizeHref({
            resumeId,
            jobId: result.job_id,
            company: result.company,
            position: result.job_title,
            region: result.region,
          })}>
            <Wand2 className="mr-1 h-3 w-3" />
            {t('aiMatch.optimizeResume')}
          </Link>
        </Button>
        <Button size="sm" variant="outline" asChild className="h-9 rounded-full border-zinc-200 text-xs hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
          <Link href={interviewHref({
            resumeId,
            jobId: result.job_id,
            company: result.company,
            position: result.job_title,
          })}>
            <Mic className="mr-1 h-3 w-3" />
            {t('aiMatch.practiceInterview')}
          </Link>
        </Button>
        <Button size="sm" variant="outline" asChild className="h-9 rounded-full border-zinc-200 text-xs hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
          <Link href={`/jobs/${result.job_id}`}>
            {t('aiMatch.viewJob')}
          </Link>
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
        <button type="button" disabled={busy} onClick={onFavorite} className={`hover:text-zinc-900 dark:hover:text-zinc-100 ${favorite ? 'text-zinc-900 dark:text-zinc-50' : ''}`}>
          {favorite ? t('aiMatch.saved') : t('aiMatch.save')}
        </button>
        <button type="button" disabled={busy || tracked} onClick={onTrack} className={`hover:text-zinc-900 dark:hover:text-zinc-100 ${tracked ? 'text-zinc-900 dark:text-zinc-50' : ''}`}>
          {tracked ? t('aiMatch.tracked') : t('aiMatch.trackApplication')}
        </button>
        <button type="button" onClick={() => onFeedback('interested')} className={`hover:text-zinc-900 dark:hover:text-zinc-100 ${feedback === 'interested' ? 'text-zinc-900 dark:text-zinc-50' : ''}`}>
          {t('aiMatch.interested')}
        </button>
        <button type="button" onClick={() => onFeedback('not_interested')} className={`hover:text-zinc-900 dark:hover:text-zinc-100 ${feedback === 'not_interested' ? 'text-zinc-900 dark:text-zinc-50' : ''}`}>
          {t('aiMatch.notInterested')}
        </button>
        <button type="button" onClick={() => onFeedback('inaccurate')} className={`hover:text-zinc-900 dark:hover:text-zinc-100 ${feedback === 'inaccurate' ? 'text-zinc-900 dark:text-zinc-50' : ''}`}>
          {t('aiMatch.inaccurate')}
        </button>
      </div>
    </article>
  );
}

// 内部组件
function AIMatchContent() {
  const { t, locale } = useLanguage();
  const { costFor, formatCost, balance: creditBalance } = useCreditPrices();
  const creditCost = formatCost(costFor('ai_match') ?? MATCH_CREDIT_COST_FALLBACK);
  const { loading: resumesLoading, error: resumesError, availability, reload: fetchResumes } = useResumeAvailability<Resume>();
  const [configsError, setConfigsError] = useState('');
  const [selectedResumeId, setSelectedResumeId] = useState<string>('');
  const [matching, setMatching] = useState(false);
  const [matchProgress, setMatchProgress] = useState(0);
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [matchError, setMatchError] = useState('');
  const [matchNotice, setMatchNotice] = useState('');
  const [teaser, setTeaser] = useState<MatchTeaser>(emptyMatchTeaser());
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewPending, setPreviewPending] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [listView, setListView] = useState<'screen' | 'explained'>('screen');
  const [paywallHint, setPaywallHint] = useState(false);
  const [reportRestored, setReportRestored] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set());
  const [applicationIds, setApplicationIds] = useState<Set<number>>(new Set());
  const [actionBusy, setActionBusy] = useState<Set<number>>(new Set());
  const [feedbackByJob, setFeedbackByJob] = useState<Record<number, MatchFeedbackValue>>({});
  const [hiddenJobIds, setHiddenJobIds] = useState<Set<number>>(new Set());
  const [undoNotice, setUndoNotice] = useState<{ jobId: number; title: string } | null>(null);
  const [matchStage, setMatchStage] = useState<MatchStage>('');
  const [explainProgress, setExplainProgress] = useState({ current: 0, total: 0 });
  const [matchSummary, setMatchSummary] = useState<MatchRunSummary | null>(null);
  const [filtersReady, setFiltersReady] = useState(false);
  const [configsLoaded, setConfigsLoaded] = useState(false);
  const [jobTypeOptions, setJobTypeOptions] = useState<JobConfig[]>(FALLBACK_JOB_TYPES);
  const [selectedJobTypes, setSelectedJobTypes] = useState<MatchJobType[]>([]);
  const [sponsorshipFilter, setSponsorshipFilter] = useState<SponsorshipFilter>('any');
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matchAbortRef = useRef<AbortController | null>(null);
  const matchingRef = useRef(false);
  const filtersKeyRef = useRef('');
  const skipFilterClearRef = useRef(true);
  const restoreEpochRef = useRef(0);
  
  // 筛选相关状态
  const [regions, setRegions] = useState<JobConfig[]>([]);
  const [directions, setDirections] = useState<JobConfig[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedDirections, setSelectedDirections] = useState<string[]>([]);
  const progressResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const eligibleResumes = availability.eligible;

  useEffect(() => {
    void fetchJobConfigs();
    void fetchUserSignals();
    return () => {
      if (progressResetTimeout.current) clearTimeout(progressResetTimeout.current);
    };
  }, []);

  useEffect(() => {
    if (resumesLoading) return;
    setSelectedResumeId((current) => {
      const stored = readActiveResumeId();
      const next = pickEligibleResumeId(eligibleResumes, current || stored);
      if (next) writeActiveResumeId(next);
      return next ? String(next) : '';
    });
  }, [eligibleResumes, resumesLoading]);

  const fetchUserSignals = async () => {
    try {
      const [favoritesResponse, applicationsResponse] = await Promise.all([
        apiFetch('/api/favorites'),
        apiFetch('/api/applications'),
      ]);
      if (favoritesResponse.ok) {
        const data = await favoritesResponse.json() as { favorites?: Array<{ job_id: number }> };
        setFavoriteIds(new Set((data.favorites || []).map((item) => Number(item.job_id)).filter(Number.isInteger)));
      }
      if (applicationsResponse.ok) {
        const data = await applicationsResponse.json() as { applications?: Array<{ job_id: number }> };
        setApplicationIds(new Set((data.applications || []).map((item) => Number(item.job_id)).filter(Number.isInteger)));
      }
    } catch (error) {
      console.warn('Failed to load saved job signals:', error);
    }
  };

  const fetchFeedback = async (resumeId: string) => {
    if (!resumeId) {
      setFeedbackByJob({});
      return;
    }
    try {
      const response = await apiFetch(`/api/ai/match/feedback?resumeId=${encodeURIComponent(resumeId)}`);
      if (!response.ok) return;
      const data = await readApiJson<{ feedback?: Array<{ job_id: number; feedback?: MatchFeedbackValue }> }>(response, t('aiMatch.actionFailed'));
      const next: Record<number, MatchFeedbackValue> = {};
      for (const item of data.feedback || []) {
        const jobId = Number(item.job_id);
        if (!Number.isInteger(jobId)) continue;
        if (item.feedback === 'interested' || item.feedback === 'not_interested' || item.feedback === 'inaccurate') {
          next[jobId] = item.feedback;
        }
      }
      setFeedbackByJob(next);
    } catch (error) {
      console.warn('Failed to load match feedback:', error);
    }
  };

  const fetchJobConfigs = async () => {
    setConfigsError('');
    try {
      const response = await apiFetch('/api/configs');
      const data = await readApiJson<{ configs?: Record<string, JobConfig[]> } & ApiErrorPayload>(response, t('aiMatch.filtersLoadFailed'));
      if (!response.ok) throw new Error(getApiErrorMessage(data, t('aiMatch.filtersLoadFailed')));
      if (data.configs) {
        setRegions(data.configs.region || []);
        setDirections(data.configs.direction || []);
        setJobTypeOptions((data.configs.job_type || []).length > 0 ? data.configs.job_type || [] : FALLBACK_JOB_TYPES);
      }
    } catch (error) {
      console.error('Failed to fetch job configs:', error);
      setConfigsError(error instanceof Error ? error.message : t('aiMatch.filtersLoadFailed'));
    } finally {
      setConfigsLoaded(true);
    }
  };

  const applyMatchNotices = (data: MatchResponse) => {
    if (data.match_summary) setMatchSummary(data.match_summary);
    if (data.no_suitable_candidates) {
      setMatchNotice('');
      return;
    }
    const notices = [
      data.partial ? t('aiMatch.partialNotice', { count: data.matches?.length || 0 }) : '',
      data.failed_batch_count && data.batch_count
        ? t('aiMatch.batchPartialNotice', { completed: data.completed_batch_count || 0, total: data.batch_count })
        : '',
      data.feedback_excluded_count
        ? t('aiMatch.feedbackFilteredNotice', { count: data.feedback_excluded_count })
        : '',
      data.persistence_warning || '',
    ].filter(Boolean);
    if (notices.length > 0) setMatchNotice(notices.join(' '));
  };

  const handleMatch = async (refresh = false) => {
    if (!selectedResumeId || matching) return;

    matchAbortRef.current?.abort();
    restoreEpochRef.current += 1;
    const controller = new AbortController();
    matchAbortRef.current = controller;
    matchingRef.current = true;
    setMatching(true);
    setMatchProgress(8);
    setMatchStage('retrieval');
    setMatchError('');
    setMatchNotice('');
    setHiddenJobIds(new Set());
    setUndoNotice(null);
    setReportRestored(false);
    setPaywallHint(false);
    setListView('explained');
    setMatchResults([]);

    const finishProgress = () => {
      setMatchProgress(100);
      setMatchStage('complete');
      if (progressResetTimeout.current) clearTimeout(progressResetTimeout.current);
      progressResetTimeout.current = setTimeout(() => {
        setMatchProgress(0);
        setMatchStage('');
        progressResetTimeout.current = null;
      }, 1000);
    };

    try {
      const response = await apiFetch('/api/ai/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          resumeId: selectedResumeId,
          regions: selectedRegions,
          directions: selectedDirections,
          jobTypes: selectedJobTypes,
          sponsorship: sponsorshipFilter,
          locale,
          refresh,
          stream: true,
        }),
      });

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        if (!response.ok) {
          const data = await readApiJson<MatchResponse>(response, t('aiMatch.failedRetry'));
          throw new Error(getApiErrorMessage(data, t('aiMatch.failedRetry')));
        }
        await readMatchStream(response, (event) => {
          if (event.type === 'stage') {
            setMatchStage(event.stage);
            if (event.stage === 'retrieval') setMatchProgress(16);
            if (event.stage === 'ranking') setMatchProgress(36);
            if (event.stage === 'explaining') {
              const total = event.total || 8;
              const current = event.current || 0;
              setExplainProgress({ current, total });
              setMatchProgress(55 + Math.round((current / Math.max(1, total)) * 35));
            }
            if (event.stage === 'complete') setMatchProgress(100);
          }
          if (event.type === 'ranked' && event.matches) {
            setMatchResults(event.matches);
            setMatchProgress((current) => Math.max(current, 48));
          }
          if (event.type === 'explanation' && event.match) {
            setMatchResults((current) => {
              const next = current.some((item) => item.job_id === event.match?.job_id)
                ? current.map((item) => item.job_id === event.match?.job_id ? event.match as MatchResult : item)
                : [...current, event.match as MatchResult];
              return [...next].sort((left, right) => right.match_score - left.match_score);
            });
          }
          if (event.type === 'done' && event.payload) {
            if (event.payload.matches) setMatchResults(event.payload.matches);
            if (event.payload.restored) {
              setReportRestored(true);
              setMatchNotice(t('aiMatch.restoredNotice'));
            }
            applyMatchNotices(event.payload);
          }
          if (event.type === 'error' && event.error) {
            setMatchError(event.error);
          }
        });
        finishProgress();
      } else {
        const data = await readApiJson<MatchResponse>(response, t('aiMatch.failedRetry'));
        if (!response.ok) throw new Error(getApiErrorMessage(data, t('aiMatch.failedRetry')));
        setMatchResults(data.matches || []);
        if (data.restored) {
          setReportRestored(true);
          setMatchNotice(t('aiMatch.restoredNotice'));
        }
        applyMatchNotices(data);
        finishProgress();
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setMatchNotice(t('aiMatch.cancelled'));
        matchingRef.current = false;
        setMatching(false);
        setMatchStage('');
        setMatchProgress(0);
        setListView('screen');
        return;
      }
      console.error('Match failed:', error);
      setMatchError(error instanceof Error ? error.message : t('aiMatch.failedRetry'));
    } finally {
      matchingRef.current = false;
      setMatching(false);
    }
  };

  const fetchPreview = async () => {
    if (!selectedResumeId || resumesLoading || eligibleResumes.length === 0) {
      setTeaser(emptyMatchTeaser());
      setPreviewPending(false);
      setPreviewLoading(false);
      return;
    }
    setPreviewPending(false);
    setPreviewLoading(true);
    setPreviewError('');
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    const filters: MatchFilterSnapshot = {
      regions: selectedRegions,
      directions: selectedDirections,
      jobTypes: selectedJobTypes,
      sponsorship: sponsorshipFilter,
    };
    const resume = eligibleResumes.find((item) => String(item.id) === selectedResumeId);
    const profileVersion = Number(resume?.profile_version || 0);
    try {
      const response = await apiFetch('/api/ai/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          resumeId: selectedResumeId,
          regions: selectedRegions,
          directions: selectedDirections,
          jobTypes: selectedJobTypes,
          sponsorship: sponsorshipFilter,
          locale,
          preview: true,
        }),
      });
      const data = await readApiJson<MatchResponse>(response, t('aiMatch.previewFailed'));
      if (!response.ok) throw new Error(getApiErrorMessage(data, t('aiMatch.previewFailed')));
      const nextTeaser = data.teaser || emptyMatchTeaser();
      setTeaser(nextTeaser);
      if (data.match_summary) setMatchSummary(data.match_summary);
      writePreviewCache(selectedResumeId, profileVersion, filters, nextTeaser, data.match_summary || null);
      if (data.feedback_excluded_count && nextTeaser.sample_count > 0) {
        setMatchNotice(t('aiMatch.feedbackFilteredNotice', { count: data.feedback_excluded_count }));
      }
      if (data.no_suitable_candidates) setPreviewError('');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error('Preview failed:', error);
      setPreviewError(error instanceof Error ? error.message : t('aiMatch.previewFailed'));
    } finally {
      if (previewAbortRef.current === controller) {
        setPreviewLoading(false);
        setPreviewPending(false);
      }
    }
  };

  useEffect(() => {
    if (!filtersReady) return;
    const resume = eligibleResumes.find((item) => String(item.id) === selectedResumeId);
    const profileVersion = Number(resume?.profile_version || 0);
    const filters: MatchFilterSnapshot = {
      regions: selectedRegions,
      directions: selectedDirections,
      jobTypes: selectedJobTypes,
      sponsorship: sponsorshipFilter,
    };
    const cached = selectedResumeId ? readPreviewCache(selectedResumeId, profileVersion, filters) : null;
    if (cached) {
      setTeaser(cached.teaser);
      if (cached.summary) setMatchSummary(cached.summary);
      setPreviewPending(false);
    } else {
      setPreviewPending(true);
    }
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewAbortRef.current?.abort();
    previewTimerRef.current = setTimeout(() => {
      void fetchPreview();
      previewTimerRef.current = null;
    }, cached ? 400 : 180);
    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      previewAbortRef.current?.abort();
    };
  }, [selectedResumeId, selectedRegions, selectedDirections, selectedJobTypes, sponsorshipFilter, resumesLoading, locale, filtersReady]);

  useEffect(() => {
    const resume = eligibleResumes.find((item) => String(item.id) === selectedResumeId);
    if (!resume || resumesLoading || !configsLoaded) return;
    const key = `${resume.id}:${resume.profile_version || 0}`;
    if (filtersKeyRef.current === key) return;
    const stored = readStoredFilters(String(resume.id), Number(resume.profile_version || 0));
    if (stored) {
      setSelectedRegions(stored.regions);
      setSelectedDirections(stored.directions);
      setSelectedJobTypes(stored.jobTypes);
      setSponsorshipFilter(stored.sponsorship);
    } else {
      const defaults = defaultMatchFilters({
        profile: resume.profile,
        segmentation: resume.segmentation,
        regionOptions: regions.map((item) => item.config_value),
        jobTypeOptions: jobTypeOptions.map((item) => item.config_value),
      });
      setSelectedRegions(defaults.regions);
      setSelectedJobTypes(defaults.jobTypes);
      setSponsorshipFilter(defaults.sponsorship);
    }
    filtersKeyRef.current = key;
    skipFilterClearRef.current = true;
    setTeaser(emptyMatchTeaser());
    setMatchResults([]);
    setReportRestored(false);
    setListView('screen');
    setFiltersReady(true);
  }, [selectedResumeId, eligibleResumes, resumesLoading, regions, jobTypeOptions, configsLoaded]);

  useEffect(() => {
    if (!filtersReady || !selectedResumeId) return;
    const resume = eligibleResumes.find((item) => String(item.id) === selectedResumeId);
    writeStoredFilters(selectedResumeId, Number(resume?.profile_version || 0), {
      regions: selectedRegions,
      directions: selectedDirections,
      jobTypes: selectedJobTypes,
      sponsorship: sponsorshipFilter,
    });
  }, [filtersReady, selectedResumeId, selectedRegions, selectedDirections, selectedJobTypes, sponsorshipFilter, eligibleResumes]);

  useEffect(() => {
    if (!filtersReady) return;
    if (skipFilterClearRef.current) {
      skipFilterClearRef.current = false;
      return;
    }
    restoreEpochRef.current += 1;
    setMatchResults([]);
    setReportRestored(false);
    setListView('screen');
  }, [selectedRegions, selectedDirections, selectedJobTypes, sponsorshipFilter, filtersReady]);

  useEffect(() => {
    if (!selectedResumeId || !filtersReady) return;
    const epoch = restoreEpochRef.current;
    let active = true;
    const restore = async () => {
      try {
        const params = new URLSearchParams({ resumeId: selectedResumeId });
        if (selectedRegions.length) params.set('regions', selectedRegions.join(','));
        if (selectedDirections.length) params.set('directions', selectedDirections.join(','));
        if (selectedJobTypes.length) params.set('jobTypes', selectedJobTypes.join(','));
        params.set('sponsorship', sponsorshipFilter);
        const response = await apiFetch(`/api/ai/match?${params.toString()}`);
        if (!response.ok) return;
        const data = await readApiJson<{ matches?: MatchResult[]; match_summary?: MatchRunSummary | null; restored?: boolean }>(response, t('aiMatch.failedRetry'));
        if (!active || epoch !== restoreEpochRef.current || matchingRef.current || !data.matches?.length) return;
        setMatchResults(data.matches);
        setReportRestored(Boolean(data.restored));
        setListView('explained');
        if (data.match_summary) setMatchSummary(data.match_summary);
        if (data.restored) setMatchNotice(t('aiMatch.restoredNotice'));
      } catch (error) {
        console.warn('Failed to restore match history:', error);
      }
    };
    void restore();
    return () => {
      active = false;
    };
  }, [selectedResumeId, filtersReady, selectedRegions, selectedDirections, selectedJobTypes, sponsorshipFilter, t]);

  useEffect(() => {
    void fetchFeedback(selectedResumeId);
  }, [selectedResumeId]);

  const markBusy = (jobId: number, busy: boolean) => {
    setActionBusy((current) => {
      const next = new Set(current);
      if (busy) next.add(jobId); else next.delete(jobId);
      return next;
    });
  };

  const toggleFavorite = async (jobId: number) => {
    if (actionBusy.has(jobId)) return;
    const isFavorite = favoriteIds.has(jobId);
    markBusy(jobId, true);
    try {
      const response = await apiFetch('/api/favorites', {
        method: isFavorite ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId }),
      });
      if (!response.ok) throw new Error();
      setFavoriteIds((current) => {
        const next = new Set(current);
        if (isFavorite) next.delete(jobId); else next.add(jobId);
        return next;
      });
    } catch {
      setMatchError(t('aiMatch.actionFailed'));
    } finally {
      markBusy(jobId, false);
    }
  };

  const trackApplication = async (jobId: number) => {
    if (actionBusy.has(jobId) || applicationIds.has(jobId)) return;
    markBusy(jobId, true);
    try {
      const response = await apiFetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, resume_id: Number(selectedResumeId), status: 'pending', notes: '' }),
      });
      if (!response.ok) throw new Error();
      setApplicationIds((current) => new Set(current).add(jobId));
    } catch {
      setMatchError(t('aiMatch.actionFailed'));
    } finally {
      markBusy(jobId, false);
    }
  };

  const sendFeedback = async (jobId: number, feedback: MatchFeedbackValue) => {
    const current = feedbackByJob[jobId];
    const result = matchResults.find((item) => item.job_id === jobId);
    try {
      if (current === feedback) {
        const response = await apiFetch('/api/ai/match/feedback', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resumeId: Number(selectedResumeId), jobId }),
        });
        if (!response.ok) throw new Error();
        setFeedbackByJob((value) => {
          const next = { ...value };
          delete next[jobId];
          return next;
        });
        setHiddenJobIds((value) => {
          const next = new Set(value);
          next.delete(jobId);
          return next;
        });
        setUndoNotice(null);
        return;
      }
      const response = await apiFetch('/api/ai/match/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeId: Number(selectedResumeId), jobId, feedback, locale }),
      });
      if (!response.ok) throw new Error();
      setFeedbackByJob((value) => ({ ...value, [jobId]: feedback }));
      if (feedback === 'not_interested' || feedback === 'inaccurate') {
        setHiddenJobIds((value) => new Set(value).add(jobId));
        setUndoNotice({ jobId, title: result?.job_title || '' });
      } else {
        setHiddenJobIds((value) => {
          const next = new Set(value);
          next.delete(jobId);
          return next;
        });
        setUndoNotice(null);
      }
    } catch {
      setMatchError(t('aiMatch.actionFailed'));
    }
  };

  const undoHiddenFeedback = async () => {
    if (!undoNotice) return;
    await sendFeedback(undoNotice.jobId, feedbackByJob[undoNotice.jobId]);
  };

  const getDecisionLabel = (type?: MatchResult['recommendation_type']) => {
    if (type === 'apply_now') return t('aiMatch.applyNow');
    if (type === 'improve_then_apply') return t('aiMatch.improveThenApply');
    return t('aiMatch.lowPriority');
  };

  const getSponsorshipLabel = (value?: 'yes' | 'no' | 'unknown' | null) => {
    if (value === 'yes') return t('aiMatch.sponsorshipYes');
    if (value === 'no') return t('aiMatch.sponsorshipNo');
    return t('aiMatch.sponsorshipUnknown');
  };

  const visibleResults = matchResults.filter((result) => !hiddenJobIds.has(result.job_id));
  const featuredIds = new Set(
    (visibleResults.filter((item) => item.recommendation_type === 'apply_now' || !item.recommendation_type).slice(0, 2).length > 0
      ? visibleResults.filter((item) => item.recommendation_type === 'apply_now' || !item.recommendation_type)
      : visibleResults
    ).slice(0, 2).map((item) => item.job_id),
  );
  const exclusionText = exclusionDetails(matchSummary?.exclusions, locale, t);
  const emptyReason = matchSummary?.empty_reason || null;
  const screeningBusy = previewPending || previewLoading;
  const showScreening = listView === 'screen';
  const hasExplainedResults = visibleResults.some((item) => item.analysis_source === 'model' && item.match_reason);
  const hasActiveFilters = selectedRegions.length > 0 || selectedDirections.length > 0 || selectedJobTypes.length > 0 || sponsorshipFilter !== 'any';
  const hasTeaser = teaser.report_count > 0 || teaser.sample_count > 0;
  const focusLabel = selectedJobTypes.length > 0
    ? selectedJobTypes.map((item) => localizeJobEnum(item, t) || item).join(locale === 'en' ? ', ' : ' / ')
    : t('aiMatch.teaserFocusFallback');
  const maxRegionCount = Math.max(1, ...teaser.region_mix.map((item) => item.count));
  const pulsePaywall = () => {
    setPaywallHint(true);
    window.setTimeout(() => setPaywallHint(false), 1600);
  };

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <Header1 />
      <main className="light-scope relative container mx-auto max-w-6xl px-4 pt-20 pb-16 sm:px-6 md:pt-24">
        {/* Hero：左对齐 eyebrow + 大标题（Tailark 式） */}
        <div className="relative mb-6 max-w-3xl md:mb-8">
          <p className="text-sm font-medium text-zinc-400 dark:text-zinc-500 mb-3">{t('aiMatch.eyebrow')}</p>
          <PageBackButton fallbackHref="/resume" className="mb-3" />
          <h1 className="break-words text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 md:text-4xl mb-3">{t('aiMatch.title')}</h1>
          <p className="text-zinc-500 dark:text-zinc-400 max-w-2xl leading-relaxed md:text-base">{t('aiMatch.subtitle')}</p>
        </div>

        <div className="mb-6 md:mb-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <Select value={selectedResumeId} onValueChange={(value) => { setSelectedResumeId(value); writeActiveResumeId(Number(value)); }} disabled={resumesLoading || eligibleResumes.length === 0}>
              <SelectTrigger className="h-10 w-full rounded-full border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950 lg:w-52">
                <SelectValue placeholder={t('aiMatch.selectResumePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {eligibleResumes.map((resume) => (
                  <SelectItem key={resume.id} value={resume.id.toString()}>
                    {resume.file_name}
                    {resume.user_info?.name && ` - ${resume.user_info.name}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <MultiSelectFilter
                label={t('aiMatch.region')}
                icon={MapPin}
                options={regions}
                selected={selectedRegions}
                onChange={setSelectedRegions}
                t={t}
              />
              <MultiSelectFilter
                label={t('aiMatch.direction')}
                icon={Compass}
                options={directions}
                selected={selectedDirections}
                onChange={setSelectedDirections}
                t={t}
              />
              <MultiSelectFilter
                label={t('aiMatch.jobType')}
                icon={Briefcase}
                options={jobTypeOptions}
                selected={selectedJobTypes}
                onChange={(values) => setSelectedJobTypes(values.filter((item): item is MatchJobType => item === '实习' || item === '校招' || item === '社招'))}
                t={t}
              />
              <Select value={sponsorshipFilter} onValueChange={(value) => setSponsorshipFilter(value as SponsorshipFilter)}>
                <SelectTrigger className="h-10 w-auto rounded-full border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-3.5 w-3.5 text-zinc-400" />
                    <SelectValue placeholder={t('aiMatch.sponsorship')} />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exclude_no">{t('aiMatch.sponsorshipExcludeNo')}</SelectItem>
                  <SelectItem value="require_yes">{t('aiMatch.sponsorshipRequireYes')}</SelectItem>
                  <SelectItem value="any">{t('aiMatch.sponsorshipAny')}</SelectItem>
                </SelectContent>
              </Select>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRegions([]);
                    setSelectedDirections([]);
                    setSelectedJobTypes([]);
                    setSponsorshipFilter('any');
                  }}
                  className="px-1 text-xs text-zinc-400 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  {t('aiMatch.clearAll')}
                </button>
              )}
            </div>
            <Button
              onClick={() => void handleMatch()}
              disabled={!selectedResumeId || matching || resumesLoading || (screeningBusy && !hasTeaser)}
              className={`h-10 w-full rounded-full bg-zinc-900 px-5 text-white hover:bg-zinc-800 lg:w-auto dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 ${paywallHint ? 'ring-2 ring-zinc-900/20 ring-offset-2' : ''}`}
            >
              {matching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('aiMatch.matching')}
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  {t('aiMatch.startAiMatchCost', { cost: creditCost })}
                </>
              )}
            </Button>
          </div>

          {(matching || screeningBusy || matchError || matchNotice || undoNotice) && (
            <div className="mt-3 space-y-2">
              {matching && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">
                      {matchStage === 'retrieval' && t('aiMatch.stageRetrieval')}
                      {matchStage === 'ranking' && t('aiMatch.stageRanking')}
                      {matchStage === 'explaining' && t('aiMatch.stageWriting', { current: explainProgress.current, total: explainProgress.total || MATCH_REPORT_LIMIT })}
                      {matchStage === 'complete' && t('aiMatch.stageComplete')}
                      {!matchStage && t('aiMatch.analyzing')}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs tabular-nums text-zinc-500">{matchProgress}%</span>
                      <button
                        type="button"
                        onClick={() => matchAbortRef.current?.abort()}
                        className="text-xs text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                      >
                        {t('aiMatch.cancel')}
                      </button>
                    </div>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div className="h-full rounded-full bg-zinc-900 transition-all duration-500 dark:bg-white" style={{ width: `${matchProgress}%` }} />
                  </div>
                </div>
              )}
              {screeningBusy && !matching && (
                <p className="flex items-center gap-2 text-xs text-zinc-400" aria-live="polite">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {hasTeaser ? t('aiMatch.previewRefreshing') : t('aiMatch.previewLoading')}
                  <span className="text-zinc-300 dark:text-zinc-600">·</span>
                  {t('aiMatch.previewHint')}
                </p>
              )}
              {matchError && (
                <p className="text-xs text-red-600 dark:text-red-400">{matchError}</p>
              )}
              {matchNotice && !matchError && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{matchNotice}</p>
              )}
              {undoNotice && (
                <p className="flex items-center gap-2 text-xs text-zinc-500">
                  <span>{t('aiMatch.hiddenByFeedback', { title: undoNotice.title })}</span>
                  <button type="button" className="underline" onClick={() => void undoHiddenFeedback()}>
                    {t('aiMatch.undo')}
                  </button>
                </p>
              )}
            </div>
          )}
          <ResumeAvailabilityHint
            status={availability.status}
            loading={resumesLoading}
            error={resumesError ? t('aiMatch.resumeLoadFailed') : ''}
            onRetry={() => void fetchResumes(true)}
            className="mt-3"
          />
          {configsError && (
            <p className="mt-2 text-xs text-zinc-400">{t('aiMatch.filtersUnavailable')}</p>
          )}
        </div>

        {showScreening && (hasTeaser || screeningBusy) && (
          <section className="mb-8" aria-label={t('aiMatch.previewTitle')}>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-400">{t('aiMatch.previewTitle')}</p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  {t('aiMatch.teaserReportHint', { count: teaser.report_count || MATCH_REPORT_LIMIT })}
                </h2>
              </div>
              <div className="flex items-center gap-3 text-xs text-zinc-400">
                {creditBalance !== null && <span>{t('aiMatch.creditBalance', { balance: creditBalance })}</span>}
                {(hasExplainedResults || matching) && (
                  <button
                    type="button"
                    onClick={() => setListView('explained')}
                    className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    {t('aiMatch.viewExplained')}
                  </button>
                )}
              </div>
            </div>
            {screeningBusy && !hasTeaser ? (
              <TeaserSkeleton />
            ) : (
              <div className={`relative overflow-hidden rounded-[28px] border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 ${screeningBusy ? 'opacity-70' : ''}`}>
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(24,24,27,0.05),transparent_42%),radial-gradient(ellipse_at_bottom_right,rgba(24,24,27,0.04),transparent_36%)]" />
                <div className="relative grid gap-8 p-6 md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] md:p-10">
                  <div className="flex flex-col justify-between">
                    <div>
                      <p className="text-sm text-zinc-500">{t('aiMatch.teaserSuitable')}</p>
                      <div className="mt-2 flex items-end gap-3">
                        <span className="text-6xl font-semibold tracking-tighter text-zinc-900 tabular-nums md:text-7xl dark:text-zinc-50">
                          {teaser.suitable_count || teaser.report_count}
                        </span>
                        <span className="mb-2 max-w-[8rem] text-sm leading-5 text-zinc-500">{t('aiMatch.teaserSuitableUnit')}</span>
                      </div>
                      <p className="mt-4 max-w-md text-sm leading-6 text-zinc-500">
                        {t('aiMatch.teaserJudgment', { focus: focusLabel })}
                      </p>
                      {teaser.region_mix.length > 0 && (
                        <div className="mt-6 space-y-2.5">
                          {teaser.region_mix.map((item, index) => (
                            <div key={`${item.label}-${index}`} className="flex items-center gap-3">
                              <span className="w-20 truncate text-xs text-zinc-500">{item.label || t('aiMatch.otherRegion')}</span>
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                                <div
                                  className="h-full rounded-full bg-zinc-900 dark:bg-white"
                                  style={{ width: `${Math.max(8, Math.round((item.count / maxRegionCount) * 100))}%` }}
                                />
                              </div>
                              <span className="w-6 text-right text-xs tabular-nums text-zinc-400">{item.count}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="mt-8">
                      <Button
                        onClick={() => void handleMatch()}
                        disabled={!selectedResumeId || matching || resumesLoading}
                        className={`h-12 rounded-full bg-zinc-900 px-6 text-sm text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 ${paywallHint ? 'ring-2 ring-zinc-900/15 ring-offset-2' : ''}`}
                      >
                        <Sparkles className="mr-2 h-4 w-4" />
                        {t('aiMatch.startAiMatchCost', { cost: creditCost })}
                      </Button>
                      <p className="mt-3 flex items-center gap-1.5 text-xs text-zinc-400">
                        <Coins className="h-3.5 w-3.5" />
                        {t('aiMatch.teaserCtaHint')}
                      </p>
                      {paywallHint && (
                        <p className="mt-2 text-xs text-zinc-600">{t('aiMatch.unlockPaywall')}</p>
                      )}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-400">{t('aiMatch.teaserSamplesTitle')}</p>
                    {teaser.samples.map((sample) => (
                      <LockedSampleCard
                        key={`${sample.company}-${sample.title}`}
                        company={sample.company}
                        title={sample.title}
                        region={sample.region}
                        direction={sample.direction}
                        onUnlock={pulsePaywall}
                        t={t}
                      />
                    ))}
                    {teaser.locked_count > 0 && (
                      <button
                        type="button"
                        onClick={pulsePaywall}
                        className="flex min-h-[5.5rem] w-full items-center justify-between rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/80 px-5 text-left transition-colors hover:border-zinc-500 hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/50"
                      >
                        <div>
                          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{t('aiMatch.teaserMoreLocked', { count: teaser.locked_count })}</p>
                          <p className="mt-1 text-xs text-zinc-500">{t('aiMatch.teaserLockedHint')}</p>
                        </div>
                        <Lock className="h-4 w-4 text-zinc-400" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
        {previewError && showScreening && !matchError && <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">{previewError}</p>}

        {listView === 'explained' && matching && visibleResults.length === 0 && (
          <div className="mb-8">
            <ReportSkeleton />
          </div>
        )}

        {listView === 'explained' && visibleResults.length > 0 && (
          <div className="relative space-y-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-400">{t('aiMatch.reportFeatured')}</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 md:text-3xl dark:text-zinc-50">
                  {t('aiMatch.matchResults')}
                </h2>
                {matchSummary && (
                  <p className="mt-2 max-w-2xl text-sm text-zinc-500">
                    {t('aiMatch.summaryLine', {
                      retrieved: matchSummary.retrieved_count,
                      selected: matchSummary.selected_count || visibleResults.length,
                    })}
                    {exclusionText ? ` ${t('aiMatch.summaryExcluded', { details: exclusionText })}` : ''}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setListView('screen')} className="h-9 rounded-full text-xs hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                  <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                  {t('aiMatch.backToPreview')}
                </Button>
                {reportRestored && (
                  <span className="rounded-full border border-zinc-200 px-3 py-1 text-[11px] text-zinc-500 dark:border-zinc-700">{t('aiMatch.reportRestored')}</span>
                )}
                <Button type="button" variant="outline" size="sm" onClick={() => void handleMatch(true)} disabled={matching} className="h-9 rounded-full text-xs hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                  {t('aiMatch.refreshAnalysis')}
                </Button>
                <span className="text-xs tabular-nums text-zinc-400">{visibleResults.length} / {MATCH_REPORT_LIMIT}</span>
              </div>
            </div>

            {(['apply_now', 'improve_then_apply', 'low_priority'] as const).map((group) => {
              const groupedResults = visibleResults.filter((result) => result.recommendation_type === group || (!result.recommendation_type && group === 'apply_now'));
              if (groupedResults.length === 0) return null;
              const groupTitle = group === 'apply_now'
                ? t('aiMatch.applyNow')
                : group === 'improve_then_apply'
                  ? t('aiMatch.improveThenApply')
                  : t('aiMatch.lowPriority');
              return (
                <section key={group} className="space-y-4">
                  <div className="flex items-baseline gap-3">
                    <h3 className="text-sm font-medium uppercase tracking-[0.18em] text-zinc-400">{groupTitle}</h3>
                    <span className="text-xs tabular-nums text-zinc-300">{groupedResults.length}</span>
                  </div>
                  {groupedResults.map((result) => (
                    <MatchReportCard
                      key={result.job_id}
                      result={result}
                      featured={featuredIds.has(result.job_id)}
                      matching={matching}
                      favorite={favoriteIds.has(result.job_id)}
                      tracked={applicationIds.has(result.job_id)}
                      feedback={feedbackByJob[result.job_id]}
                      busy={actionBusy.has(result.job_id)}
                      resumeId={selectedResumeId}
                      decisionLabel={getDecisionLabel(result.recommendation_type)}
                      sponsorshipLabel={getSponsorshipLabel(result.sponsorship)}
                      t={t}
                      onFavorite={() => void toggleFavorite(result.job_id)}
                      onTrack={() => void trackApplication(result.job_id)}
                      onFeedback={(value) => void sendFeedback(result.job_id, value)}
                    />
                  ))}
                </section>
              );
            })}
          </div>
        )}

        {/* Empty State */}
        {showScreening && !matching && !screeningBusy && !hasTeaser && availability.status === 'ready' && (
          <div className="relative rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/60">
            <div className="py-12 md:py-16 text-center px-4">
              <h3 className="text-lg md:text-xl font-semibold tracking-tight mb-2 text-zinc-900 dark:text-zinc-50">
                {emptyReason === 'no_retrieval'
                  ? t('aiMatch.emptyRetrievalTitle')
                  : emptyReason === 'no_suitable'
                    ? t('aiMatch.emptyFilteredTitle')
                    : t('aiMatch.emptyTitle')}
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
                {emptyReason === 'no_retrieval'
                  ? t('aiMatch.emptyRetrievalDesc')
                  : emptyReason === 'no_suitable'
                    ? t('aiMatch.emptyFilteredDesc', { retrieved: matchSummary?.retrieved_count || 0 })
                    : t('aiMatch.emptyDesc')}
              </p>
              {(emptyReason === 'no_retrieval' || emptyReason === 'no_suitable') && (
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  {sponsorshipFilter !== 'any' && (
                    <Button type="button" variant="outline" size="sm" className="h-9 rounded-xl text-xs" onClick={() => setSponsorshipFilter('any')}>
                      {t('aiMatch.relaxSponsorship')}
                    </Button>
                  )}
                  {selectedJobTypes.length > 0 && (
                    <Button type="button" variant="outline" size="sm" className="h-9 rounded-xl text-xs" onClick={() => setSelectedJobTypes([])}>
                      {t('aiMatch.relaxJobType')}
                    </Button>
                  )}
                  {selectedRegions.length > 0 && (
                    <Button type="button" variant="outline" size="sm" className="h-9 rounded-xl text-xs" onClick={() => setSelectedRegions([])}>
                      {t('aiMatch.relaxRegions')}
                    </Button>
                  )}
                  <Button type="button" variant="outline" size="sm" className="h-9 rounded-xl text-xs" asChild>
                    <Link href="/jobs">{t('aiMatch.browseJobs')}</Link>
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// 主组件
export default function AIMatchPage() {
  return (
    <AuthGuard>
      <AIMatchContent />
    </AuthGuard>
  );
}
