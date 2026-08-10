'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
  ArrowLeft, 
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
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth-guard';
import { apiFetch } from '@/lib/api-client';

interface Job {
  id: number;
  title: string;
  company: string;
  region: string;
  direction: string;
  audience: string;
  description: string;
  requirements?: string;
  overview?: string;
  responsibilities?: string;
  nice_to_have?: string;
  salary_range: string;
  job_url: string;
  logo_url?: string;
  sponsorship?: 'yes' | 'no' | 'unknown';
  created_at: string;
  application_deadline?: string;
  job_type?: string;
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
  { key: 'ats', label: 'ATS 可解析性' },
  { key: 'keywords', label: '关键词匹配' },
  { key: 'experience', label: '经历匹配' },
  { key: 'evidence', label: '成果证据' },
  { key: 'region', label: '地区策略' },
  { key: 'profile_fit', label: '画像适配度' },
];

// Company Logo Component
function CompanyLogo({ company, logoUrl, size = 'md' }: { company: string; logoUrl?: string; size?: 'sm' | 'md' | 'lg' }) {
  const [logoError, setLogoError] = useState(false);
  const [clearbitUrl, setClearbitUrl] = useState<string | null>(null);
  
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
  };

  useEffect(() => {
    if (!logoUrl && company) {
      const domain = company.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .replace(/\s+/g, '');
      setClearbitUrl(`https://logo.clearbit.com/${domain}.com?size=128`);
    }
  }, [company, logoUrl]);

  const logoSource = logoUrl || clearbitUrl;
  
  if (logoSource && !logoError) {
    return (
      <div className={`${sizeClasses[size]} rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden bg-white flex-shrink-0`}>
        <img
          src={logoSource}
          alt={`${company} logo`}
          className="w-full h-full object-contain p-1.5"
          onError={() => setLogoError(true)}
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
  const router = useRouter();
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
  
  useEffect(() => {
    const fetchJob = async () => {
      try {
        const response = await apiFetch(`/api/jobs/${params.id}`);
        if (!response.ok) {
          throw new Error('岗位不存在');
        }
        const data = await response.json();
        setJob(data.job);
        
        // 获取同公司其他岗位
        if (data.job.company) {
          const relatedRes = await apiFetch(`/api/jobs?company=${encodeURIComponent(data.job.company)}&limit=5`);
          const relatedData = await relatedRes.json();
          const others = (relatedData.jobs || []).filter((j: Job) => j.id !== data.job.id);
          setRelatedJobs(others.slice(0, 4));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
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
        if (!response.ok) throw new Error(data.error || '读取岗位评分失败');
        if (active) setMatch(data.match || null);
      } catch (error) {
        if (active) setMatchError(error instanceof Error ? error.message : '读取岗位评分失败');
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

  const handleApply = async () => {
    if (applied) {
      router.push('/applications');
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
        }),
      });
      
      const data = await response.json();
      
      if (data.application) {
        setApplied(true);
        router.push('/applications');
      } else if (data.error) {
        alert('投递失败: ' + data.error);
      }
    } catch (error) {
      alert('投递失败，请重试');
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
      if (!response.ok) throw new Error(data.error || '岗位评分失败，请重试');
      const nextMatch = data.matches?.[0] as JobMatchSnapshot | undefined;
      if (!nextMatch) throw new Error('未返回有效的岗位评分，请重试');
      setMatch(nextMatch);
    } catch (error) {
      setMatchError(error instanceof Error ? error.message : '岗位评分失败，请重试');
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
      if (!response.ok) throw new Error(data.error || '收藏操作失败');
      setIsFavorite(nextFavorite);
    } catch (error) {
      alert(error instanceof Error ? error.message : '收藏操作失败，请重试');
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
        <p className="text-zinc-500 dark:text-zinc-400">{error || '岗位不存在'}</p>
        <Button onClick={() => router.back()} className="bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回岗位列表
        </Button>
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
        <Button variant="ghost" className="mb-4 h-9 text-sm text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-100" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回岗位列表
        </Button>

        {/* 主卡片 - 核心信息 */}
        <Card className="mb-4 rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none">
          <CardContent className="pt-4 md:pt-6">
            {/* Header: Logo + Title */}
            <div className="flex items-start gap-3 md:gap-4 mb-4">
              <CompanyLogo company={job.company} logoUrl={job.logo_url} size="lg" />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 mb-1 line-clamp-2">{job.title}</h1>
                    <p className="text-base md:text-lg text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      {job.company}
                      {isNew && <Badge className="bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-xs hover:bg-zinc-900">新发布</Badge>}
                      {isHot && <Badge variant="outline" className="border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 text-xs">热招</Badge>}
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
                      可提供Sponsor
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      不提供Sponsor - 不适合留学生
                    </span>
                  )}
                </Badge>
              )}
            </div>

            {/* 截止日期 */}
            {job.application_deadline && (
              <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                <Calendar className="h-4 w-4" />
                <span>截止日期：{job.application_deadline}</span>
              </div>
            )}

            <Separator className="my-4 bg-zinc-100 dark:bg-zinc-800" />

            {/* CTA 按钮 */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                className="bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 flex-1"
                onClick={handleApply}
                disabled={applying}
              >
                {applying ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    投递中...
                  </>
                ) : applied ? (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    已投递 (查看进度)
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    去官网申请
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                title={isFavorite ? '取消收藏' : '收藏岗位'}
                aria-label={isFavorite ? '取消收藏' : '收藏岗位'}
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
                  <a href={job.job_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    原链接
                  </a>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 目标岗位评分 */}
        <Card className="mb-4 rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-zinc-900 dark:text-zinc-50">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-zinc-900 dark:bg-white">
                <Sparkles className="h-3.5 w-3.5 text-white dark:text-zinc-900" />
              </span>
              目标岗位评分
            </CardTitle>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              使用已确认的求职画像，查看这份简历与当前岗位的匹配度和关键差距。
            </p>
          </CardHeader>
          <CardContent>
            {resumes.length === 0 ? (
              <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  暂无已确认画像，请先上传简历并完成求职画像确认。
                </p>
                <Button asChild variant="outline" size="sm" className="border-zinc-200 dark:border-zinc-700">
                  <Link href="/resume">
                    <FileText className="mr-2 h-4 w-4" />
                    去管理简历
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <label htmlFor="job-score-resume" className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    选择已确认简历
                  </label>
                  <Select value={selectedResumeId} onValueChange={setSelectedResumeId}>
                    <SelectTrigger id="job-score-resume" className="h-10 w-full rounded-xl border-zinc-200 dark:border-zinc-700">
                      <SelectValue placeholder="选择一份简历" />
                    </SelectTrigger>
                    <SelectContent>
                      {resumes.map((resume) => (
                        <SelectItem key={resume.id} value={String(resume.id)}>
                          {resume.file_name}
                          {resume.user_info?.name ? ` · ${resume.user_info.name}` : ''}
                          {resume.profile_version ? ` · 画像 v${resume.profile_version}` : ''}
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
                  {match ? '重新评分' : '生成岗位评分'}
                </Button>
              </div>
            )}

            {matchError && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
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
                    <span className="pb-1 text-sm text-zinc-400 dark:text-zinc-500">/ 100 匹配分</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{match.match_reason}</p>
                    <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                      基于画像 v{match.resume_profile_version} 的评分快照
                    </p>
                  </div>
                </div>

                <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
                  {scoreBreakdownLabels.map(({ key, label }) => {
                    const value = Math.max(0, Math.min(100, Number(match.score_breakdown?.[key] ?? 0)));
                    return (
                      <div key={key}>
                        <div className="mb-1 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                          <span>{label}</span>
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
                        <h3 className="mb-1.5 text-sm font-medium text-emerald-900 dark:text-emerald-200">匹配证据</h3>
                        <ul className="list-disc space-y-1 pl-4 text-xs text-emerald-800 dark:text-emerald-300">
                          {match.evidence.map((item) => <li key={item}>{item}</li>)}
                        </ul>
                      </div>
                    )}
                    {match.key_gaps.length > 0 && (
                      <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
                        <h3 className="mb-1.5 text-sm font-medium text-amber-900 dark:text-amber-200">关键差距</h3>
                        <ul className="list-disc space-y-1 pl-4 text-xs text-amber-800 dark:text-amber-300">
                          {match.key_gaps.map((item) => <li key={item}>{item}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {match.suggestions && (
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
                    <h3 className="mb-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">下一步优化建议</h3>
                    <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{match.suggestions}</p>
                  </div>
                )}

                <Button asChild variant="outline" className="h-10 rounded-xl border-zinc-200 dark:border-zinc-700">
                  <Link href={`/optimize?resumeId=${match.resume_id}&jobId=${job.id}&company=${encodeURIComponent(job.company)}&position=${encodeURIComponent(job.title)}&region=${encodeURIComponent(job.region)}&suggestions=${encodeURIComponent(match.suggestions || '')}`}>
                    <Sparkles className="mr-2 h-4 w-4" />
                    按当前岗位优化简历
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
                <CompanyLogo company={job.company_info.company_name} logoUrl={job.company_info.logo_url} size="md" />
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
                      行业：{job.company_info.industry}
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
                    公司介绍
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
                    查看公司全部职位
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
                <span className="font-medium text-sm text-zinc-900 dark:text-zinc-50">岗位概述</span>
              </div>
              <p className="text-sm md:text-base text-zinc-600 dark:text-zinc-300 leading-relaxed">
                {job.overview}
              </p>
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
                    岗位职责
                    <Badge variant="secondary" className="text-xs ml-1 bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-100">{items.length}条</Badge>
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
                        收起
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4 mr-1" />
                        查看全部 {items.length} 条岗位职责
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
                    任职要求
                    <Badge variant="secondary" className="text-xs ml-1 bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-100">{items.length}条</Badge>
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
                        收起
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4 mr-1" />
                        查看全部 {items.length} 条任职要求
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
                加分项
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
                岗位描述
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
                  同公司其他岗位 {relatedJobs.length > 0 && `(${relatedJobs.length})`}
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
                    查看全部职位
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
                  去 {job.company} 官网申请
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
                <span>发布于 {new Date(job.created_at).toLocaleDateString('zh-CN')}</span>
                <span className="mx-2">·</span>
                <span>{postedDays === 0 ? '今天' : `${postedDays}天前`}</span>
              </div>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-100" asChild>
                <a href={`/jobs?company=${encodeURIComponent(job.company)}`}>
                  <Briefcase className="h-3 w-3 mr-1" />
                  查看更多{job.company}岗位
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
