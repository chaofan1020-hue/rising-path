'use client';

import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  MapPin, 
  Briefcase, 
  Users,
  Building2,
  ExternalLink,
  Clock,
  DollarSign,
  FileText,
  Loader2,
  Send,
  Heart,
  Sparkles,
  Target,
  CheckCircle,
  Star,
  GraduationCap,
  AlertCircle,
  Calendar,
  ChevronRight,
  ChevronDown,
  Globe,
  AlertTriangle,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth-guard';
import { apiFetch } from '@/lib/api-client';
import PageBackButton from '@/components/page-back-button';
import { AutoApplyAssistant } from '@/components/auto-apply-assistant';
import { useLanguage } from '@/lib/language-context';
import { getJobDeadlineRemaining } from '@/lib/job-deadline';

interface Job {
  id: number;
  title: string;
  company: string;
  region: string;
  direction: string;
  audience: string;
  description: string | null;
  requirements?: string;
  overview?: string;
  responsibilities?: string;
  nice_to_have?: string;
  salary_range: string;
  job_url: string;
  logo_url?: string;
  logo_fallback_url?: string;
  sponsorship?: 'yes' | 'no' | 'unknown';
  created_at: string;
  valid_through?: string | null;
  deadline_time_zone?: string | null;
  application_deadline?: string | null;
  job_type?: string;
  experience_min_years?: number | null;
  experience_max_years?: number | null;
  experience_text?: string | null;
  // 公司信息
  company_info?: {
    id: number;
    company_name: string;
    careers_page?: string;
    logo_url?: string;
    short_desc?: string;
    full_desc?: string;
    headquarters?: string;
    industry?: string;
  };
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

function formatDeadline(value: string | null | undefined, timeZone?: string | null): string | null {
  const date = getDeadlineDate(value);
  return date
    ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timeZone || 'UTC' }).format(date)
    : null;
}

function formatDeadlineRemaining(value: string | null | undefined, now: number, t: (key: string, params?: Record<string, string | number>) => string): string | null {
  if (!now) return null;
  const remaining = getJobDeadlineRemaining(value, now);
  if (!remaining) return null;
  // Deadline expiry alone is not a verified job closure.
  if (remaining.expired) return null;
  if (remaining.days > 7) return null;
  return t('jobs.daysLeft', { days: remaining.days });
}

function formatExperienceSummary(job: Pick<Job, 'experience_min_years' | 'experience_max_years' | 'experience_text'>, t: (key: string, params?: Record<string, string | number>) => string): string | null {
  if (job.experience_min_years != null && job.experience_max_years != null) return t('jobDetail.experienceRange', { min: job.experience_min_years, max: job.experience_max_years });
  if (job.experience_min_years != null) return t('jobDetail.experiencePlus', { min: job.experience_min_years });
  if (job.experience_max_years != null) return t('jobDetail.experienceMax', { max: job.experience_max_years });
  return job.experience_text?.trim() || null;
}

function formatExperienceRequirement(job: Pick<Job, 'experience_min_years' | 'experience_max_years' | 'experience_text'>, t: (key: string, params?: Record<string, string | number>) => string): string | null {
  if (job.experience_text?.trim()) return job.experience_text.trim();
  return formatExperienceSummary(job, t);
}

interface RelatedJob {
  id: number;
  title: string;
  region: string;
}

interface ResumeOption {
  id: number;
  file_name: string;
  processing_status?: string;
  segmentation_confirmed?: boolean;
  profile_version?: number;
  user_info?: {
    name?: string;
  };
}

interface JobMatchSnapshot {
  id?: number;
  resume_id: number;
  job_id: number;
  match_score: number;
  match_reason: string;
  suggestions: string;
  score_breakdown: Record<string, number>;
  evidence: string[];
  key_gaps: string[];
  resume_profile_version: number;
  created_at?: string;
}

const scoreBreakdownLabels: Array<{ key: string; label: string }> = [
  { key: 'ats', label: 'jobDetail.scoreAts' },
  { key: 'keywords', label: 'jobDetail.scoreKeywords' },
  { key: 'experience', label: 'jobDetail.scoreExperience' },
  { key: 'evidence', label: 'jobDetail.scoreEvidence' },
  { key: 'region', label: 'jobDetail.scoreRegion' },
  { key: 'profile_fit', label: 'jobDetail.scoreProfileFit' },
];

// Company Logo Component
function CompanyLogo({ company, logoUrl, fallbackLogoUrl, size = 'md' }: { company: string; logoUrl?: string; fallbackLogoUrl?: string; size?: 'sm' | 'md' | 'lg' }) {
  const [failedSource, setFailedSource] = useState<'primary' | 'fallback' | null>(null);

  useEffect(() => {
    setFailedSource(null);
  }, [logoUrl, fallbackLogoUrl]);
  
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
  };

  const logoSource = failedSource === 'primary'
    ? fallbackLogoUrl
    : failedSource === 'fallback'
      ? null
      : logoUrl;
  
  if (logoSource) {
    return (
      <div className={`${sizeClasses[size]} rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden bg-white flex-shrink-0`}>
        <img
          src={logoSource}
          alt={`${company} logo`}
          className="w-full h-full object-contain p-1.5"
          onError={() => setFailedSource(logoSource === logoUrl && fallbackLogoUrl ? 'primary' : 'fallback')}
        />
      </div>
    );
  }

  const initial = company?.charAt(0)?.toUpperCase() || '?';
  return (
    <div className={`${sizeClasses[size]} rounded-xl bg-zinc-900 dark:bg-white flex items-center justify-center flex-shrink-0 shadow-lg shadow-zinc-900/15 dark:shadow-black/30`}>
      <span className={`${size === 'lg' ? 'text-2xl' : 'text-lg'} font-bold text-white dark:text-zinc-900`}>{initial}</span>
    </div>
  );
}

// Badge variants（极简黑白灰：所有信息徽章统一中性灰底）
function InfoBadge({ icon: Icon, children, variant = 'default' }: { icon: LucideIcon; children: React.ReactNode; variant?: 'default' | 'success' | 'warning' | 'info' }) {
  const variants = {
    default: 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700',
    success: 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700',
    warning: 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700',
    info: 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700',
  };
  
  return (
    <Badge variant="outline" className={`${variants[variant]} rounded-md text-xs md:text-sm font-normal`}>
      <Icon className="h-3 w-3 mr-1" />
      {children}
    </Badge>
  );
}

// 内部组件
function JobDetailContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const [job, setJob] = useState<Job | null>(null);
  const [relatedJobs, setRelatedJobs] = useState<RelatedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [resumes, setResumes] = useState<ResumeOption[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState('');
  const [match, setMatch] = useState<JobMatchSnapshot | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [showAllResponsibilities, setShowAllResponsibilities] = useState(false);
  const [showAllRequirements, setShowAllRequirements] = useState(false);
  const [deadlineNow, setDeadlineNow] = useState(0);

  const requestedResumeId = searchParams.get('resumeId');

  useEffect(() => {
    setDeadlineNow(Date.now());
    const timer = window.setInterval(() => setDeadlineNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  
  useEffect(() => {
    const fetchJob = async () => {
      try {
        const response = await apiFetch(`/api/jobs/${params.id}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || t('jobDetail.notFound'));
        }
        const data = payload;
        setJob(data.job);
        
        // 获取同公司其他岗位
        if (data.job.company) {
          const relatedRes = await apiFetch(`/api/jobs?company=${encodeURIComponent(data.job.company)}&limit=5`);
          const relatedData = await relatedRes.json();
          const others = (relatedData.jobs || []).filter((j: Job) => j.id !== data.job.id);
          setRelatedJobs(others.slice(0, 4));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('jobDetail.loadFailed'));
      } finally {
        setLoading(false);
      }
    };

    if (params.id) {
      fetchJob();
      checkIfApplied();
      fetchConfirmedResumes();
      checkIfFavorite();
    }
  }, [params.id]);

  const fetchConfirmedResumes = async () => {
    try {
      const response = await apiFetch('/api/resume');
      if (!response.ok) return;
      const data = await response.json();
      const availableResumes = (data.resumes || []).filter((resume: ResumeOption) => (
        resume.processing_status === 'ready' && resume.segmentation_confirmed === true
      ));
      setResumes(availableResumes);
      const requestedResume = Number(requestedResumeId);
      if (Number.isInteger(requestedResume) && availableResumes.some((resume: ResumeOption) => resume.id === requestedResume)) {
        setSelectedResumeId(String(requestedResume));
        return;
      }
      if (availableResumes.length === 1) {
        setSelectedResumeId(String(availableResumes[0].id));
      }
    } catch (error) {
      console.error('Failed to fetch confirmed resumes:', error);
    }
  };

  const checkIfFavorite = async () => {
    try {
      const response = await apiFetch('/api/favorites');
      if (!response.ok) return;
      const data = await response.json();
      setIsFavorite((data.favorites || []).some((favorite: { job_id: number }) => (
        favorite.job_id === Number(params.id)
      )));
    } catch (error) {
      console.error('Failed to check favorite status:', error);
    }
  };

  useEffect(() => {
    if (!selectedResumeId || !params.id) {
      setMatch(null);
      return;
    }

    let active = true;
    const fetchSavedMatch = async () => {
      setMatchLoading(true);
      setMatchError('');
      try {
        const response = await apiFetch(
          `/api/ai/match?jobId=${encodeURIComponent(String(params.id))}&resumeId=${encodeURIComponent(selectedResumeId)}`,
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || t('jobDetail.scoreLoadFailed'));
        if (active) setMatch(data.match || null);
      } catch (error) {
        if (active) setMatchError(error instanceof Error ? error.message : t('jobDetail.scoreLoadFailed'));
      } finally {
        if (active) setMatchLoading(false);
      }
    };

    fetchSavedMatch();
    return () => {
      active = false;
    };
  }, [params.id, selectedResumeId]);

  const checkIfApplied = async () => {
    if (!params.id) return;
    try {
      const response = await apiFetch('/api/applications');
      const data = await response.json();
      const hasApplied = (data.applications || []).some((app: { job_id: number }) => app.job_id === Number(params.id));
      setApplied(hasApplied);
    } catch (error) {
      console.error('Failed to check application status:', error);
    }
  };

  const handleAutoApply = async () => {
    if (applied) {
      if (job?.job_url) {
        const applyContext = {
          jobId: Number(params.id),
          company: job.company,
          title: job.title,
          jobUrl: job.job_url,
          resumeId: selectedResumeId ? Number(selectedResumeId) : undefined,
        };
        window.postMessage({ type: "liorvix-apply-context", context: applyContext }, window.location.origin);
        window.open(`/api/jobs/${job.id}/open`, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    if (!job?.job_url) {
      alert(t('jobDetail.noWebsite'));
      return;
    }

    setApplying(true);
    try {
      const response = await apiFetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: Number(params.id),
          status: 'pending',
          notes: '',
          ...(selectedResumeId ? { resume_id: Number(selectedResumeId) } : {}),
        }),
      });
      
      const data = await response.json();
      
      if (data.application) {
        setApplied(true);
        const applyContext = {
          jobId: Number(params.id),
          company: job.company,
          title: job.title,
          jobUrl: job.job_url,
          resumeId: selectedResumeId ? Number(selectedResumeId) : undefined,
        };
        window.postMessage({ type: "liorvix-apply-context", context: applyContext }, window.location.origin);
        window.open(`/api/jobs/${job.id}/open`, '_blank', 'noopener,noreferrer');
      } else if (data.error) {
        alert(`${t('jobDetail.applyFailed')}: ${data.error}`);
      }
    } catch (error) {
      alert(t('jobDetail.applyRetry'));
    } finally {
      setApplying(false);
    }
  };

  const handleScore = async () => {
    if (!selectedResumeId || !params.id) return;

    setMatchLoading(true);
    setMatchError('');
    try {
      const response = await apiFetch('/api/ai/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resumeId: selectedResumeId,
          jobId: Number(params.id),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('jobDetail.scoreFailed'));
      const nextMatch = data.matches?.[0] as JobMatchSnapshot | undefined;
      if (!nextMatch) throw new Error(t('jobDetail.scoreInvalid'));
      setMatch(nextMatch);
    } catch (error) {
      setMatchError(error instanceof Error ? error.message : t('jobDetail.scoreFailed'));
    } finally {
      setMatchLoading(false);
    }
  };

  const handleFavorite = async () => {
    if (!params.id) return;

    const nextFavorite = !isFavorite;
    setFavoriteLoading(true);
    try {
      const response = await apiFetch('/api/favorites', {
        method: nextFavorite ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: Number(params.id) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('jobDetail.favoriteFailed'));
      setIsFavorite(nextFavorite);
    } catch (error) {
      alert(error instanceof Error ? error.message : t('jobDetail.favoriteRetry'));
    } finally {
      setFavoriteLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-zinc-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="min-h-screen bg-white dark:bg-zinc-950 flex flex-col items-center justify-center gap-4">
        <AlertCircle className="h-12 w-12 text-zinc-300 dark:text-zinc-600" />
        <p className="text-zinc-500 dark:text-zinc-400">{error || t('jobDetail.notFound')}</p>
        <PageBackButton fallbackHref="/jobs" label={t('jobDetail.backToJobs')} />
      </div>
    );
  }

  // 计算新鲜度
  const postedDays = Math.floor((Date.now() - new Date(job.created_at).getTime()) / (1000 * 60 * 60 * 24));
  const isNew = postedDays <= 7;
  const isHot = (relatedJobs.length > 3);

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="container mx-auto px-4 py-4 md:py-8 max-w-4xl">
        {/* 返回按钮 */}
        <PageBackButton fallbackHref="/jobs" label={t('jobDetail.backToJobs')} className="mb-4" />

        {/* 主卡片 - 核心信息 */}
        <Card className="mb-4 rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none">
          <CardContent className="pt-4 md:pt-6">
            {/* Header: Logo + Title */}
            <div className="flex items-start gap-3 md:gap-4 mb-4">
              <CompanyLogo company={job.company} logoUrl={job.logo_url} fallbackLogoUrl={job.logo_fallback_url} size="lg" />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 mb-1 line-clamp-2">{job.title}</h1>
                    <p className="text-base md:text-lg text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      {job.company}
                      {isNew && <Badge className="bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-xs hover:bg-zinc-900">{t('jobDetail.new')}</Badge>}
                      {isHot && <Badge variant="outline" className="border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 text-xs">{t('jobDetail.hot')}</Badge>}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* 关键信息标签 */}
            <div className="flex flex-wrap gap-2 mb-4">
              <InfoBadge icon={MapPin}>{job.region}</InfoBadge>
              <InfoBadge icon={GraduationCap}>{job.audience || job.job_type || 'Entry-level'}</InfoBadge>
              {job.direction && <InfoBadge icon={Briefcase}>{job.direction}</InfoBadge>}
              {formatExperienceSummary(job, t) && <InfoBadge icon={Clock}>{formatExperienceSummary(job, t)}</InfoBadge>}
              {job.salary_range && (
                <InfoBadge icon={DollarSign} variant="success">{job.salary_range}</InfoBadge>
              )}
              {job.sponsorship && job.sponsorship !== 'unknown' && (
                <Badge
                  className={job.sponsorship === 'yes'
                    ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:bg-zinc-900 text-xs md:text-sm font-medium px-2 py-1'
                    : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-100 text-xs md:text-sm font-medium px-2 py-1'
                  }
                >
                  {job.sponsorship === 'yes' ? (
                    <span className="flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" />
                      {t('jobDetail.sponsorshipYes')}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {t('jobDetail.sponsorshipNo')}
                    </span>
                  )}
                </Badge>
              )}
            </div>

            {/* 截止日期与剩余时间：日期来自上游 valid_through，不做发布时间推算。 */}
            {(() => {
              const deadline = job.valid_through || job.application_deadline;
              const formattedDeadline = formatDeadline(deadline, job.deadline_time_zone);
              if (!formattedDeadline) return null;
              const remaining = formatDeadlineRemaining(deadline, deadlineNow, t);
              return (
                <div className="mb-4 space-y-1.5 text-sm">
                  <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                    <Calendar className="h-4 w-4" />
                    <span>{t('jobs.deadlineLabel')}：{formattedDeadline}</span>
                  </div>
                  {remaining && (
                    <p className="font-semibold text-red-600 dark:text-red-400">
                      {remaining}
                    </p>
                  )}
                </div>
              );
            })()}

            <Separator className="my-4 bg-zinc-100 dark:bg-zinc-800" />

            {/* CTA 按钮 */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                className="bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 flex-1"
                onClick={handleAutoApply}
                disabled={applying}
              >
                {applying ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t('jobDetail.opening')}
                  </>
                ) : applied ? (
                  <>
                    <Zap className="h-4 w-4 mr-2" />
                    {t('jobDetail.autoApplyAgain')}
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4 mr-2" />
                    {t('jobDetail.autoApply')}
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                title={isFavorite ? t('jobDetail.unfavorite') : t('jobDetail.favorite')}
                aria-label={isFavorite ? t('jobDetail.unfavorite') : t('jobDetail.favorite')}
                aria-pressed={isFavorite}
                onClick={handleFavorite}
                disabled={favoriteLoading}
                className="h-11 w-11 flex-shrink-0 border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
              >
                {favoriteLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Heart className={`h-4 w-4 ${isFavorite ? 'fill-current' : ''}`} />
                )}
              </Button>
              {job.job_url && (
                <Button variant="outline" asChild className="flex-1 sm:flex-none border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                  <a href={`/api/jobs/${job.id}/open`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    {t('jobDetail.originalLink')}
                  </a>
                </Button>
              )}
            </div>
            <AutoApplyAssistant
              context={{
                jobId: Number(params.id),
                company: job.company,
                title: job.title,
                jobUrl: job.job_url,
                resumeId: selectedResumeId ? Number(selectedResumeId) : undefined,
              }}
            />
          </CardContent>
        </Card>

        {/* 目标岗位评分 */}
        <Card className="mb-4 rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-zinc-900 dark:text-zinc-50">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-zinc-900 dark:bg-white">
                <Sparkles className="h-3.5 w-3.5 text-white dark:text-zinc-900" />
              </span>
              {t('jobDetail.scoreTitle')}
            </CardTitle>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t('jobDetail.scoreDescription')}
            </p>
          </CardHeader>
          <CardContent>
            {resumes.length === 0 ? (
              <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {t('jobDetail.noConfirmedResume')}
                </p>
                <Button asChild variant="outline" size="sm" className="border-zinc-200 dark:border-zinc-700">
                  <Link href="/resume">
                    <FileText className="mr-2 h-4 w-4" />
                    {t('jobDetail.manageResume')}
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <label htmlFor="job-score-resume" className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    {t('jobDetail.selectConfirmedResume')}
                  </label>
                  <Select value={selectedResumeId} onValueChange={setSelectedResumeId}>
                    <SelectTrigger id="job-score-resume" className="h-10 w-full rounded-xl border-zinc-200 dark:border-zinc-700">
                      <SelectValue placeholder={t('jobDetail.selectResumePlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {resumes.map((resume) => (
                        <SelectItem key={resume.id} value={String(resume.id)}>
                          {resume.file_name}
                          {resume.user_info?.name ? ` · ${resume.user_info.name}` : ''}
                          {resume.profile_version ? ` · v${resume.profile_version}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  onClick={handleScore}
                  disabled={!selectedResumeId || matchLoading}
                  className="h-10 rounded-xl bg-zinc-900 px-5 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {matchLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  {match ? t('jobDetail.rerate') : t('jobDetail.generateScore')}
                </Button>
              </div>
            )}

            {matchError && (
              <div className="mt-4 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5 text-sm text-foreground dark:bg-primary/15">
                {matchError}
              </div>
            )}

            {match && (
              <div className="mt-5 space-y-5 border-t border-zinc-100 pt-5 dark:border-zinc-800">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="flex items-end gap-2">
                    <span className="text-5xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                      {match.match_score}
                    </span>
                    <span className="pb-1 text-sm text-zinc-400 dark:text-zinc-500">{t('jobDetail.matchPoints')}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{match.match_reason}</p>
                    <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                      {t('jobDetail.scoreSnapshot', { version: match.resume_profile_version })}
                    </p>
                  </div>
                </div>

                <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
                  {scoreBreakdownLabels.map(({ key, label }) => {
                    const value = Math.max(0, Math.min(100, Number(match.score_breakdown?.[key] ?? 0)));
                    return (
                      <div key={key}>
                        <div className="mb-1 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                           <span>{t(label)}</span>
                          <span className="font-medium text-zinc-700 dark:text-zinc-200">{value}</span>
                        </div>
                        <Progress value={value} className="h-1.5" />
                      </div>
                    );
                  })}
                </div>

                {(match.evidence.length > 0 || match.key_gaps.length > 0) && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {match.evidence.length > 0 && (
                      <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                         <h3 className="mb-1.5 text-sm font-medium text-emerald-900 dark:text-emerald-200">{t('jobDetail.evidence')}</h3>
                        <ul className="list-disc space-y-1 pl-4 text-xs text-emerald-800 dark:text-emerald-300">
                          {match.evidence.map((item) => <li key={item}>{item}</li>)}
                        </ul>
                      </div>
                    )}
                    {match.key_gaps.length > 0 && (
                      <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 dark:bg-primary/15">
                         <h3 className="mb-1.5 text-sm font-medium text-foreground">{t('jobDetail.gaps')}</h3>
                        <ul className="list-disc space-y-1 pl-4 text-xs text-foreground/80">
                          {match.key_gaps.map((item) => <li key={item}>{item}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {match.suggestions && (
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
                    <h3 className="mb-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('jobDetail.suggestions')}</h3>
                    <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{match.suggestions}</p>
                  </div>
                )}

                <Button asChild variant="outline" className="h-10 rounded-xl border-zinc-200 dark:border-zinc-700">
                  <Link href={`/optimize?resumeId=${match.resume_id}&jobId=${job.id}&company=${encodeURIComponent(job.company)}&position=${encodeURIComponent(job.title)}&region=${encodeURIComponent(job.region)}&suggestions=${encodeURIComponent(match.suggestions || '')}`}>
                    <Sparkles className="mr-2 h-4 w-4" />
                    {t('jobDetail.optimizeForJob')}
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 公司信息卡 */}
        {job.company_info && (
          <Card className="mb-4 rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none">
            <CardContent className="pt-4">
              <div className="flex items-start gap-3">
                <CompanyLogo
                  company={job.company_info.company_name}
                  logoUrl={job.company_info.logo_url || job.logo_url}
                  fallbackLogoUrl={job.logo_fallback_url}
                  size="md"
                />
                <div className="flex-1">
                  <h3 className="font-semibold text-base mb-1 text-zinc-900 dark:text-zinc-50">{job.company_info.company_name}</h3>
                  {job.company_info.short_desc && (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">{job.company_info.short_desc}</p>
                  )}
                  {job.company_info.headquarters && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1 mb-1">
                      <MapPin className="h-3 w-3" />
                      {job.company_info.headquarters}
                    </p>
                  )}
                  {job.company_info.industry && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                       {t('jobDetail.industry')}: {job.company_info.industry}
                    </p>
                  )}
                </div>
              </div>
              {job.company_info.full_desc && (
                <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                  <h4 className="font-medium text-sm mb-2 flex items-center gap-2 text-zinc-900 dark:text-zinc-50">
                    <span className="w-5 h-5 rounded-md bg-zinc-900 dark:bg-white flex items-center justify-center flex-shrink-0">
                      <Building2 className="h-3 w-3 text-white dark:text-zinc-900" />
                    </span>
                     {t('jobDetail.companyIntro')}
                  </h4>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">
                    {job.company_info.full_desc}
                  </p>
                </div>
              )}
              {job.company_info.careers_page && (
                <div className="mt-4">
                  <a
                    href={job.company_info.careers_page}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-zinc-900 dark:text-zinc-100 hover:underline"
                  >
                    <Globe className="h-3 w-3" />
                     {t('jobDetail.allCompanyJobs')}
                    <ChevronRight className="h-3 w-3" />
                  </a>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 岗位概述 */}
         {job.overview && (
          <Card className="mb-4 rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none bg-zinc-50/80 dark:bg-zinc-900/40">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-5 h-5 rounded-md bg-zinc-900 dark:bg-white flex items-center justify-center flex-shrink-0">
                  <FileText className="h-3 w-3 text-white dark:text-zinc-900" />
                </span>
                 <span className="font-medium text-sm text-zinc-900 dark:text-zinc-50">{t('jobDetail.overview')}</span>
              </div>
              <p className="text-sm md:text-base text-zinc-600 dark:text-zinc-300 leading-relaxed">
                {job.overview}
              </p>
            </CardContent>
          </Card>
        )}

        {/* 经验要求：只显示官网正文或官方 ATS 字段中明确给出的要求。 */}
         {formatExperienceRequirement(job, t) && (
          <Card className="mb-4 rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base text-zinc-900 dark:text-zinc-50">
                <span className="w-6 h-6 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center flex-shrink-0">
                  <Clock className="h-3.5 w-3.5 text-white dark:text-zinc-900" />
                </span>
                 {t('jobDetail.experienceRequirement')}
              </CardTitle>
            </CardHeader>
            <CardContent>
               <p className="whitespace-pre-wrap text-sm text-zinc-500 dark:text-zinc-400">{formatExperienceRequirement(job, t)}</p>
            </CardContent>
          </Card>
        )}

        {/* 岗位职责 */}
        {job.responsibilities && (() => {
          const items = job.responsibilities.split('|').filter((item: string) => item.trim());
          const initialCount = 5;
          const showExpand = items.length > initialCount;
          const displayItems = showExpand && !showAllResponsibilities ? items.slice(0, initialCount) : items;
          
          return (
            <Card className="mb-4 rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2 text-zinc-900 dark:text-zinc-50">
                    <span className="w-6 h-6 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center flex-shrink-0">
                      <Target className="h-3.5 w-3.5 text-white dark:text-zinc-900" />
                    </span>
                     {t('jobDetail.responsibilities')}
                     <Badge variant="secondary" className="text-xs ml-1 bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-100">{items.length}{t('jobDetail.items')}</Badge>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {displayItems.map((item: string, index: number) => (
                    <li key={index} className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 flex items-center justify-center text-xs font-medium mt-0.5">
                        {index + 1}
                      </span>
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">{item.trim()}</span>
                    </li>
                  ))}
                </ul>
                {showExpand && (
                  <Button
                    variant="ghost"
                    className="w-full mt-3 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    onClick={() => setShowAllResponsibilities(!showAllResponsibilities)}
                  >
                    {showAllResponsibilities ? (
                      <>
                        <ChevronDown className="h-4 w-4 mr-1 rotate-180" />
                         {t('jobDetail.collapse')}
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4 mr-1" />
                         {t('jobDetail.viewAllResponsibilities', { count: items.length })}
                      </>
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {/* 任职要求 */}
        {job.requirements && (() => {
          const items = job.requirements.split('|').filter((item: string) => item.trim());
          const initialCount = 5;
          const showExpand = items.length > initialCount;
          const displayItems = showExpand && !showAllRequirements ? items.slice(0, initialCount) : items;
          
          return (
            <Card className="mb-4 rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="flex items-center gap-2 text-zinc-900 dark:text-zinc-50">
                    <span className="w-6 h-6 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center flex-shrink-0">
                      <CheckCircle className="h-3.5 w-3.5 text-white dark:text-zinc-900" />
                    </span>
                     {t('jobDetail.requirements')}
                     <Badge variant="secondary" className="text-xs ml-1 bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-100">{items.length}{t('jobDetail.items')}</Badge>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {displayItems.map((item: string, index: number) => (
                    <li key={index} className="flex items-start gap-3">
                      <CheckCircle className="h-4 w-4 text-zinc-300 dark:text-zinc-600 flex-shrink-0 mt-1" />
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">{item.trim()}</span>
                    </li>
                  ))}
                </ul>
                {showExpand && (
                  <Button
                    variant="ghost"
                    className="w-full mt-3 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    onClick={() => setShowAllRequirements(!showAllRequirements)}
                  >
                    {showAllRequirements ? (
                      <>
                        <ChevronDown className="h-4 w-4 mr-1 rotate-180" />
                         {t('jobDetail.collapse')}
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4 mr-1" />
                         {t('jobDetail.viewAllRequirements', { count: items.length })}
                      </>
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {/* 加分项 */}
        {job.nice_to_have && (
          <Card className="mb-4 rounded-2xl border-dashed border-zinc-200 dark:border-zinc-800 shadow-none bg-zinc-50/80 dark:bg-zinc-900/40">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base text-zinc-900 dark:text-zinc-50">
                <span className="w-6 h-6 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center flex-shrink-0">
                  <Star className="h-3.5 w-3.5 text-white dark:text-zinc-900" />
                </span>
                 {t('jobDetail.niceToHave')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {job.nice_to_have.split('|').filter((item: string) => item.trim()).map((item: string, index: number) => (
                  <li key={index} className="flex items-start gap-3">
                    <Star className="h-4 w-4 text-zinc-300 dark:text-zinc-600 flex-shrink-0 mt-1" />
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">{item.trim()}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* 原始岗位描述 - 如果没有结构化数据 */}
        {!job.overview && job.description && (
          <Card className="mb-4 rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base text-zinc-900 dark:text-zinc-50">
                <span className="w-6 h-6 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center flex-shrink-0">
                  <FileText className="h-3.5 w-3.5 text-white dark:text-zinc-900" />
                </span>
                 {t('jobDetail.description')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="whitespace-pre-wrap text-sm text-zinc-500 dark:text-zinc-400">
                {job.description}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 同公司其他岗位 - 优先跳转到公司招聘页面 */}
        {(relatedJobs.length > 0 || job.company_info?.careers_page) && (
          <Card className="mb-4 rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2 text-zinc-900 dark:text-zinc-50">
                  <span className="w-6 h-6 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center flex-shrink-0">
                    <Building2 className="h-3.5 w-3.5 text-white dark:text-zinc-900" />
                  </span>
                   {t('jobDetail.relatedJobs')} {relatedJobs.length > 0 && `(${relatedJobs.length})`}
                </span>
                {job.company_info?.careers_page && (
                  <a
                    href={job.company_info.careers_page}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 flex items-center gap-1 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Globe className="h-3 w-3" />
                     {t('jobDetail.viewAllJobs')}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {relatedJobs.length > 0 ? (
                <div className="space-y-2">
                  {relatedJobs.map((relatedJob) => (
                    <Link
                      key={relatedJob.id}
                      href={`/jobs/${relatedJob.id}`}
                      className="flex items-center justify-between p-3 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors group"
                    >
                      <div>
                        <p className="font-medium text-sm text-zinc-900 dark:text-zinc-50">{relatedJob.title}</p>
                        <p className="text-xs text-zinc-400 dark:text-zinc-500 flex items-center gap-1 mt-0.5">
                          <MapPin className="h-3 w-3" />
                          {relatedJob.region}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-zinc-300 dark:text-zinc-600 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors" />
                    </Link>
                  ))}
                </div>
              ) : job.company_info?.careers_page ? (
                <a
                  href={job.company_info.careers_page}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 p-4 rounded-lg bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 transition-colors text-zinc-900 dark:text-zinc-100 font-medium"
                >
                  <Globe className="h-5 w-5" />
                   {t('jobDetail.applyOnWebsite', { company: job.company })}
                  <ExternalLink className="h-4 w-4" />
                </a>
              ) : null}
            </CardContent>
          </Card>
        )}

        {/* 底部信息 */}
        <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between text-xs text-zinc-400 dark:text-zinc-500">
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>{t('jobDetail.posted')} {new Date(job.created_at).toLocaleDateString()}</span>
                <span className="mx-2">·</span>
                <span>{postedDays === 0 ? t('jobDetail.today') : t('jobDetail.daysAgo', { days: postedDays })}</span>
              </div>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-100" asChild>
                <a href={`/jobs?company=${encodeURIComponent(job.company)}`}>
                  <Briefcase className="h-3 w-3 mr-1" />
                   {t('jobDetail.moreCompanyJobs', { company: job.company })}
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function JobDetailPage() {
  return (
    <AuthGuard>
      <JobDetailContent />
    </AuthGuard>
  );
}
