'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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
 
  Target, 
  Loader2, 
  CheckCircle, 
  Sparkles,
  TrendingUp,
  MapPin,
  Compass,
  ChevronDown,
  X,
  Wand2,
  Heart,
  Send,
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
  CircleAlert,
} from 'lucide-react';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth-guard';
import { apiFetch } from '@/lib/api-client';
import { Header1 } from '@/components/header1';
import { useLanguage } from '@/lib/language-context';
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
  user_info: {
    name?: string;
    skills?: string[];
  };
}

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
}

interface PreviewJob {
  job_id: number;
  job_title: string;
  company: string;
  role_fit?: 'direct' | 'adjacent';
  region?: string | null;
  direction?: string | null;
  job_url?: string | null;
  salary_range?: string | null;
  sponsorship?: 'yes' | 'no' | 'unknown' | null;
  workplace_type?: string | null;
  experience_min_years?: number | null;
  experience_max_years?: number | null;
  experience_text?: string | null;
  valid_through?: string | null;
}

interface MatchResponse extends ApiErrorPayload {
  matches?: MatchResult[];
  preview_jobs?: PreviewJob[];
  candidate_count?: number;
  partial?: boolean;
  no_suitable_candidates?: boolean;
  excluded_candidate_count?: number;
  feedback_excluded_count?: number;
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
        <button className="inline-flex items-center gap-1.5 md:gap-2 px-3 py-2 md:px-4 md:py-2.5 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 transition-all text-xs md:text-sm text-zinc-700 dark:text-zinc-200">
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
              <span className="text-sm font-medium">{option.config_value}</span>
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

// 内部组件
function AIMatchContent() {
  const { t, locale } = useLanguage();
  const { loading: resumesLoading, error: resumesError, availability, reload: fetchResumes } = useResumeAvailability<Resume>();
  const [configsError, setConfigsError] = useState('');
  const [selectedResumeId, setSelectedResumeId] = useState<string>('');
  const [matching, setMatching] = useState(false);
  const [matchProgress, setMatchProgress] = useState(0);
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [matchError, setMatchError] = useState('');
  const [matchNotice, setMatchNotice] = useState('');
  const [previewJobs, setPreviewJobs] = useState<PreviewJob[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set());
  const [applicationIds, setApplicationIds] = useState<Set<number>>(new Set());
  const [actionBusy, setActionBusy] = useState<Set<number>>(new Set());
  const [feedbackIds, setFeedbackIds] = useState<Set<number>>(new Set());
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
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
      setFeedbackIds(new Set());
      return;
    }
    try {
      const response = await apiFetch(`/api/ai/match/feedback?resumeId=${encodeURIComponent(resumeId)}`);
      if (!response.ok) return;
      const data = await readApiJson<{ feedback?: Array<{ job_id: number }> }>(response, t('aiMatch.actionFailed'));
      setFeedbackIds(new Set((data.feedback || []).map((item) => Number(item.job_id)).filter(Number.isInteger)));
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
      }
    } catch (error) {
      console.error('Failed to fetch job configs:', error);
      setConfigsError(error instanceof Error ? error.message : t('aiMatch.filtersLoadFailed'));
    }
  };

  const handleMatch = async (refresh = false) => {
    if (!selectedResumeId || matching) return;

    setMatching(true);
    setMatchProgress(0);
    setMatchResults([]);
    setMatchError('');
    setMatchNotice('');

    let progressInterval: ReturnType<typeof setInterval> | null = null;
    try {
      progressInterval = setInterval(() => {
        setMatchProgress((prev) => Math.min(prev + 5, 90));
      }, 180);

      const response = await apiFetch('/api/ai/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          resumeId: selectedResumeId,
          regions: selectedRegions,
          directions: selectedDirections,
          locale,
          refresh,
        }),
      });

      clearInterval(progressInterval);
      progressInterval = null;
      setMatchProgress(100);

      const data = await readApiJson<MatchResponse>(response, t('aiMatch.failedRetry'));
      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, t('aiMatch.failedRetry')));
      }
      setMatchResults(data.matches || []);
      if (data.no_suitable_candidates) {
        setMatchNotice(t('aiMatch.noSuitableCandidates'));
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
      if (notices.length > 0) {
        setMatchNotice(notices.join(' '));
      }

      if (progressResetTimeout.current) clearTimeout(progressResetTimeout.current);
      progressResetTimeout.current = setTimeout(() => {
        setMatchProgress(0);
        progressResetTimeout.current = null;
      }, 1000);
    } catch (error) {
      console.error('Match failed:', error);
      setMatchError(error instanceof Error ? error.message : t('aiMatch.failedRetry'));
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      setMatching(false);
    }
  };

  const getScoreLabel = (score: number) => {
    if (score >= 80) return t('aiMatch.scoreHigh');
    if (score >= 60) return t('aiMatch.scoreMedium');
    return t('aiMatch.scoreLow');
  };

  const fetchPreview = async () => {
    if (!selectedResumeId || resumesLoading || eligibleResumes.length === 0) {
      setPreviewJobs([]);
      return;
    }
    setPreviewLoading(true);
    setPreviewError('');
    setMatchNotice('');
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    try {
      const response = await apiFetch('/api/ai/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          resumeId: selectedResumeId,
          regions: selectedRegions,
          directions: selectedDirections,
          locale,
          preview: true,
        }),
      });
      const data = await readApiJson<MatchResponse>(response, t('aiMatch.previewFailed'));
      if (!response.ok) throw new Error(getApiErrorMessage(data, t('aiMatch.previewFailed')));
      setPreviewJobs(data.preview_jobs || []);
      if (data.feedback_excluded_count) {
        setMatchNotice(t('aiMatch.feedbackFilteredNotice', { count: data.feedback_excluded_count }));
      }
      if (data.no_suitable_candidates) setPreviewError(t('aiMatch.noSuitableCandidates'));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error('Preview failed:', error);
      setPreviewError(error instanceof Error ? error.message : t('aiMatch.previewFailed'));
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewAbortRef.current?.abort();
    previewTimerRef.current = setTimeout(() => {
      void fetchPreview();
      previewTimerRef.current = null;
    }, 220);
    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      previewAbortRef.current?.abort();
    };
  }, [selectedResumeId, selectedRegions, selectedDirections, resumesLoading, locale]);

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

  const sendFeedback = async (jobId: number, feedback: 'interested' | 'not_interested' | 'inaccurate') => {
    if (feedbackIds.has(jobId)) return;
    try {
      const response = await apiFetch('/api/ai/match/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeId: Number(selectedResumeId), jobId, feedback, locale }),
      });
      if (!response.ok) throw new Error();
      setFeedbackIds((current) => new Set(current).add(jobId));
    } catch {
      setMatchError(t('aiMatch.actionFailed'));
    }
  };

  const actionLabel = (key: 'save' | 'saved' | 'track' | 'tracked' | 'interested' | 'notInterested' | 'inaccurate') => (
    t({ save: 'aiMatch.save', saved: 'aiMatch.saved', track: 'aiMatch.trackApplication', tracked: 'aiMatch.tracked', interested: 'aiMatch.interested', notInterested: 'aiMatch.notInterested', inaccurate: 'aiMatch.inaccurate' }[key])
  );

  const getDecisionLabel = (type?: MatchResult['recommendation_type']) => {
    if (type === 'apply_now') return t('aiMatch.applyNow');
    if (type === 'improve_then_apply') return t('aiMatch.improveThenApply');
    return t('aiMatch.lowPriority');
  };

  const getEligibilityLabel = (status?: 'eligible' | 'uncertain' | 'blocked') => {
    if (status === 'eligible') return t('aiMatch.eligibilityClear');
    if (status === 'blocked') return t('aiMatch.eligibilityBlocked');
    return t('aiMatch.eligibilityUncertain');
  };

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <Header1 />
      <main className="relative container mx-auto px-4 pt-20 pb-16 sm:px-6 md:pt-24">
        {/* Hero：左对齐 eyebrow + 大标题（Tailark 式） */}
        <div className="relative mb-8 max-w-3xl md:mb-10">
          <p className="text-sm font-medium text-zinc-400 dark:text-zinc-500 mb-3">{t('aiMatch.eyebrow')}</p>
          <PageBackButton fallbackHref="/resume" className="mb-3" />
          <h1 className="break-words text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 md:text-4xl mb-4">{t('aiMatch.title')}</h1>
          <p className="text-zinc-500 dark:text-zinc-400 max-w-2xl md:text-lg leading-relaxed">{t('aiMatch.subtitle')}</p>
        </div>

        {/* Match Form */}
        <Card className="relative mb-6 md:mb-8 rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none bg-white dark:bg-zinc-950">
          <CardHeader className="pb-2 md:pb-4">
            <CardTitle className="flex items-center gap-2.5 text-base md:text-lg tracking-tight text-zinc-900 dark:text-zinc-50">
              <span className="w-7 h-7 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center">
                <Target className="h-4 w-4 text-white dark:text-zinc-900" />
              </span>
              {t('aiMatch.startMatch')}
            </CardTitle>
            <CardDescription className="text-xs md:text-sm text-zinc-500 dark:text-zinc-400">
              {t('aiMatch.startMatchDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
              {/* 简历选择 */}
              <div className="w-full xl:w-auto">
                <label className="text-xs md:text-sm font-medium mb-1.5 block text-zinc-700 dark:text-zinc-200">{t('aiMatch.selectResume')}</label>
                <Select value={selectedResumeId} onValueChange={(value) => { setSelectedResumeId(value); writeActiveResumeId(Number(value)); }} disabled={resumesLoading || eligibleResumes.length === 0}>
                  <SelectTrigger className="h-11 w-full xl:w-56 rounded-xl border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
                    <SelectValue placeholder={t('aiMatch.selectResumePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleResumes.map((resume) => (
                      <SelectItem key={resume.id} value={resume.id.toString()}>
                        {resume.file_name}
                        {resume.user_info?.name && ` - ${resume.user_info.name}`}
                        {resume.profile_version ? ` · v${resume.profile_version}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 筛选器 - 推到右边 */}
              <div className="flex w-full flex-wrap items-center gap-2 sm:gap-3 xl:ml-auto xl:w-auto xl:flex-nowrap">
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
                <Button
                  onClick={() => void handleMatch()}
                  disabled={!selectedResumeId || matching || resumesLoading}
                  className="h-11 flex-1 rounded-xl px-4 sm:flex-none sm:px-6 bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 shadow-md hover:shadow-lg transition-all"
                >
                  {matching ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('aiMatch.matching')}
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      {t('aiMatch.startAiMatch')}
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* 已选择的筛选条件显示 */}
            {(selectedRegions.length > 0 || selectedDirections.length > 0) && (
              <div className="mt-4 flex flex-wrap gap-1.5 md:gap-2 items-center">
                <span className="text-xs md:text-sm text-zinc-400 dark:text-zinc-500">{t('aiMatch.selected')}</span>
                {selectedRegions.map((region) => (
                  <Badge
                    key={region}
                    variant="secondary"
                    className="flex items-center gap-1 pr-1 text-xs rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border-0"
                  >
                    <MapPin className="h-3 w-3" />
                    {region}
                    <button
                      onClick={() => setSelectedRegions(selectedRegions.filter(r => r !== region))}
                      className="ml-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {selectedDirections.map((direction) => (
                  <Badge
                    key={direction}
                    variant="secondary"
                    className="flex items-center gap-1 pr-1 text-xs rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border-0"
                  >
                    <Compass className="h-3 w-3" />
                    {direction}
                    <button
                      onClick={() => setSelectedDirections(selectedDirections.filter(d => d !== direction))}
                      className="ml-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <button
                  onClick={() => {
                    setSelectedRegions([]);
                    setSelectedDirections([]);
                  }}
                  className="text-xs text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                >
                  {t('aiMatch.clearAll')}
                </button>
              </div>
            )}

            {matching && (
              <div className="mt-4 md:mt-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs md:text-sm text-zinc-400 dark:text-zinc-500">{t('aiMatch.analyzing')}</span>
                  <span className="text-xs md:text-sm font-medium text-zinc-700 dark:text-zinc-200">{matchProgress}%</span>
                </div>
                <Progress value={matchProgress} className="h-1.5 md:h-2" />
              </div>
            )}
            {matchError && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                {matchError}
              </div>
            )}
            {matchNotice && (
              <div className="mt-4 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5 text-sm text-foreground dark:bg-primary/15">
                {matchNotice}
              </div>
            )}
            <ResumeAvailabilityHint
              status={availability.status}
              loading={resumesLoading}
              error={resumesError ? t('aiMatch.resumeLoadFailed') : ''}
              onRetry={() => void fetchResumes(true)}
              className="mt-4"
            />
            {configsError && (
              <p className="mt-3 text-xs text-primary">{t('aiMatch.filtersUnavailable')}</p>
            )}
          </CardContent>
        </Card>

        {previewJobs.length > 0 && matchResults.length === 0 && !matching && (
          <section className="mb-8 space-y-3" aria-label={t('aiMatch.previewTitle')}>
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  {t('aiMatch.previewTitle')}
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {t('aiMatch.previewDesc')}
                </p>
              </div>
              {previewLoading && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {previewJobs.map((job) => (
                <Card key={job.job_id} className="rounded-xl border-zinc-200 shadow-none dark:border-zinc-800">
                  <CardContent className="space-y-3 p-4">
                    <div>
                      <h3 className="line-clamp-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{job.job_title}</h3>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{job.company}</p>
                      <div className="mt-2">
                        <Badge variant={job.role_fit === 'direct' ? 'default' : 'secondary'} className="rounded-full text-[11px]">
                          {job.role_fit === 'direct' ? t('aiMatch.targetRole') : t('aiMatch.adjacentRole')}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      {job.region && <Badge variant="outline" className="rounded-full text-[11px]">{job.region}</Badge>}
                      {job.direction && <Badge variant="outline" className="rounded-full text-[11px]">{job.direction}</Badge>}
                      {job.workplace_type && <Badge variant="outline" className="rounded-full text-[11px]">{job.workplace_type}</Badge>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button type="button" size="sm" onClick={() => void handleMatch()} className="h-8 flex-1 rounded-lg text-xs">
                        <Sparkles className="mr-1 h-3.5 w-3.5" />
                        {t('aiMatch.deepMatch')}
                      </Button>
                      <Button type="button" size="icon" variant="outline" onClick={() => void toggleFavorite(job.job_id)} disabled={actionBusy.has(job.job_id)} className="h-8 w-8 rounded-lg" title={t('aiMatch.save')}>
                        <Heart className={`h-3.5 w-3.5 ${favoriteIds.has(job.job_id) ? 'fill-current' : ''}`} />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}
        {previewError && !matchError && <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">{previewError}</p>}

        {/* Match Results */}
        {matchResults.length > 0 && (
          <div className="relative space-y-4 md:space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xl md:text-2xl font-semibold tracking-tight flex items-center gap-2.5 text-zinc-900 dark:text-zinc-50">
                <span className="w-7 h-7 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center">
                  <CheckCircle className="h-4 w-4 text-white dark:text-zinc-900" />
                </span>
                {t('aiMatch.matchResults')}
              </h2>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void handleMatch(true)} disabled={matching} className="h-8 rounded-lg text-xs">
                  {t('aiMatch.refreshAnalysis')}
                </Button>
                <Badge className="text-xs bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-0 rounded-full px-3 py-1 hover:bg-zinc-900">{t('aiMatch.total')} {matchResults.length} {t('aiMatch.recommendations')}</Badge>
              </div>
            </div>

            {(['apply_now', 'improve_then_apply', 'low_priority'] as const).map((group) => {
              const groupedResults = matchResults.filter((result) => result.recommendation_type === group || (!result.recommendation_type && group === 'apply_now'));
              if (groupedResults.length === 0) return null;
              const groupTitle = group === 'apply_now'
                ? t('aiMatch.applyNow')
                : group === 'improve_then_apply'
                  ? t('aiMatch.improveThenApply')
                  : t('aiMatch.lowPriority');
              return (
                <section key={group} className="space-y-3">
                  <div className="flex items-center gap-2 pt-2">
                    <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{groupTitle}</h3>
                    <Badge variant="secondary" className="rounded-full text-xs">{groupedResults.length}</Badge>
                  </div>
                  {groupedResults.map((result) => (
              <Card key={result.job_id} className="rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none hover:shadow-xl hover:shadow-zinc-900/[0.06] dark:hover:shadow-black/30 transition-shadow duration-300 bg-white dark:bg-zinc-950 overflow-hidden">
                <CardContent className="pt-4 md:pt-6">
                  {/* 手机端：纵向布局，桌面端：横向布局 */}
                  <div className="flex flex-col md:flex-row gap-4 md:gap-6">
                    {/* Score - 手机端横向紧凑，桌面端纵向带背景 */}
                    <div className="flex items-center gap-3 md:flex-col md:items-center md:justify-center md:p-5 md:rounded-2xl md:bg-zinc-50 dark:md:bg-zinc-900/60 md:border md:border-zinc-100 dark:md:border-zinc-800 flex-shrink-0 md:min-w-[120px]">
                      <div className="text-3xl md:text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                        {result.match_score}
                      </div>
                      <div className="flex flex-col gap-0.5 md:gap-1 md:items-center">
                        <div className="text-xs md:text-sm text-zinc-400 dark:text-zinc-500">{t('aiMatch.matchScore')}</div>
                        <Badge className={`hidden md:flex rounded-full ${result.match_score >= 80 ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-0 hover:bg-zinc-900' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 hover:bg-zinc-100'}`} variant={result.match_score >= 80 ? 'default' : 'secondary'}>
                          {getScoreLabel(result.match_score)}
                        </Badge>
                      </div>
                    </div>

                    {/* Details */}
                    <div className="flex-1 space-y-3 md:space-y-4">
                      <div>
                        <h3 className="text-base md:text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{result.job_title}</h3>
                        <p className="text-xs md:text-sm text-zinc-500 dark:text-zinc-400">{result.company}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {result.recommendation_type && <Badge variant="outline" className="rounded-full text-[11px]">{getDecisionLabel(result.recommendation_type)}</Badge>}
                          {result.role_fit && <Badge variant={result.role_fit === 'direct' ? 'default' : 'secondary'} className="rounded-full text-[11px]">{result.role_fit === 'direct' ? t('aiMatch.targetRole') : t('aiMatch.adjacentRole')}</Badge>}
                          {result.eligibility?.status && <Badge variant="outline" className="rounded-full text-[11px]">{getEligibilityLabel(result.eligibility.status)}</Badge>}
                          {typeof result.confidence === 'number' && <span className="text-[11px] text-zinc-400">{t('aiMatch.confidence', { value: result.confidence })}</span>}
                        </div>
                      </div>

                      <div>
                        <h4 className="font-medium flex items-center gap-2 mb-1.5 md:mb-2 text-sm md:text-base text-zinc-900 dark:text-zinc-100">
                          <TrendingUp className="h-3.5 w-3.5 md:h-4 md:w-4 text-zinc-400 dark:text-zinc-500" />
                          {t('aiMatch.matchReason')}
                        </h4>
                        <p className="text-xs md:text-sm text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-100 dark:border-zinc-800 p-2.5 md:p-3 rounded-xl">
                          {result.match_reason}
                        </p>
                      </div>

                      {result.suggestions && (
                        <div>
                          <h4 className="font-medium flex items-center gap-2 mb-1.5 md:mb-2 text-sm md:text-base text-zinc-900 dark:text-zinc-100">
                            <Sparkles className="h-3.5 w-3.5 md:h-4 md:w-4 text-zinc-400 dark:text-zinc-500" />
                            {t('aiMatch.suggestions')}
                          </h4>
                          <p className="text-xs md:text-sm text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-100 dark:border-zinc-800 p-2.5 md:p-3 rounded-xl">
                            {result.suggestions}
                          </p>
                        </div>
                      )}

                      {((result.evidence?.length || 0) > 0 || (result.key_gaps?.length || 0) > 0) && (
                        <div className="grid gap-3 md:grid-cols-2">
                          {(result.evidence?.length || 0) > 0 && (
                            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                              <h4 className="mb-1.5 text-sm font-medium text-emerald-900 dark:text-emerald-200">{t('aiMatch.evidence')}</h4>
                              <ul className="list-disc space-y-1 pl-4 text-xs text-emerald-800 dark:text-emerald-300">
                                {result.evidence.map((item) => <li key={item}>{item}</li>)}
                              </ul>
                            </div>
                          )}
                          {(result.key_gaps?.length || 0) > 0 && (
                      <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 dark:bg-primary/15">
                        <h4 className="mb-1.5 text-sm font-medium text-foreground">{t('aiMatch.keyGaps')}</h4>
                        <ul className="list-disc space-y-1 pl-4 text-xs text-foreground/80">
                                {result.key_gaps.map((item) => <li key={item}>{item}</li>)}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                        <Button type="button" size="sm" variant="outline" onClick={() => void toggleFavorite(result.job_id)} disabled={actionBusy.has(result.job_id)} className="h-9 rounded-xl text-xs">
                          <Heart className={`mr-1 h-3 w-3 ${favoriteIds.has(result.job_id) ? 'fill-current' : ''}`} />
                          {favoriteIds.has(result.job_id) ? actionLabel('saved') : actionLabel('save')}
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => void trackApplication(result.job_id)} disabled={actionBusy.has(result.job_id) || applicationIds.has(result.job_id)} className="h-9 rounded-xl text-xs">
                          <Send className="mr-1 h-3 w-3" />
                          {applicationIds.has(result.job_id) ? actionLabel('tracked') : actionLabel('track')}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => void sendFeedback(result.job_id, 'interested')} disabled={feedbackIds.has(result.job_id)} className="h-9 rounded-xl text-xs">
                          <ThumbsUp className="mr-1 h-3 w-3" />{actionLabel('interested')}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => void sendFeedback(result.job_id, 'not_interested')} disabled={feedbackIds.has(result.job_id)} className="h-9 rounded-xl text-xs">
                          <ThumbsDown className="mr-1 h-3 w-3" />{actionLabel('notInterested')}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => void sendFeedback(result.job_id, 'inaccurate')} disabled={feedbackIds.has(result.job_id)} className="h-9 rounded-xl text-xs">
                          <CircleAlert className="mr-1 h-3 w-3" />{actionLabel('inaccurate')}
                        </Button>
                        <Button size="sm" asChild className="h-9 text-xs rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 border-0">
                          <Link href={`/optimize?resumeId=${selectedResumeId}&jobId=${result.job_id}&company=${encodeURIComponent(result.company)}&position=${encodeURIComponent(result.job_title)}&suggestions=${encodeURIComponent(result.suggestions || '')}`}>
                            <Wand2 className="mr-1 h-3 w-3" />
                            {t('aiMatch.optimizeResume')}
                          </Link>
                        </Button>
                        <Button size="sm" variant="outline" asChild className="h-9 text-xs rounded-xl border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                          <Link href={`/jobs/${result.job_id}`}>
                            <ExternalLink className="mr-1 h-3 w-3" />
                            {t('aiMatch.viewJob')}
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
                  ))}
                </section>
              );
            })}
          </div>
        )}

        {/* Empty State */}
        {!matching && matchResults.length === 0 && previewJobs.length === 0 && availability.status === 'ready' && (
          <div className="relative rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/60">
            <div className="py-12 md:py-16 text-center px-4">
              <h3 className="text-lg md:text-xl font-semibold tracking-tight mb-2 text-zinc-900 dark:text-zinc-50">{t('aiMatch.emptyTitle')}</h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
                {t('aiMatch.emptyDesc')}
              </p>
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
