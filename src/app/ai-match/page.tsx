'use client';

import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth-guard';
import { apiFetch } from '@/lib/api-client';
import { Header1 } from '@/components/header1';
import { useLanguage } from '@/lib/language-context';

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
  match_score: number;
  match_reason: string;
  suggestions: string;
  score_breakdown: Record<string, number>;
  evidence: string[];
  key_gaps: string[];
  resume_profile_version: number;
}

interface JobConfig {
  id: number;
  config_type: string;
  config_value: string;
  sort_order: number;
  is_active: boolean;
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
            <label
              key={option.id}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
                selected.includes(option.config_value)
                  ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60'
              }`}
              translate="no"
            >
              <Checkbox
                checked={selected.includes(option.config_value)}
                onCheckedChange={() => handleToggle(option.config_value)}
                className="data-[state=checked]:bg-zinc-900 data-[state=checked]:border-zinc-900 dark:data-[state=checked]:bg-white dark:data-[state=checked]:border-white dark:data-[state=checked]:text-zinc-900"
              />
              <span className="text-sm font-medium">{option.config_value}</span>
            </label>
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
  const { t } = useLanguage();
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<string>('');
  const [matching, setMatching] = useState(false);
  const [matchProgress, setMatchProgress] = useState(0);
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [matchError, setMatchError] = useState('');
  
  // 筛选相关状态
  const [regions, setRegions] = useState<JobConfig[]>([]);
  const [directions, setDirections] = useState<JobConfig[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedDirections, setSelectedDirections] = useState<string[]>([]);

  useEffect(() => {
    fetchResumes();
    fetchJobConfigs();
  }, []);

  const fetchResumes = async () => {
    try {
      const response = await apiFetch('/api/resume');
      const data = await response.json();
      setResumes((data.resumes || []).filter((resume: Resume) => (
        resume.processing_status === 'ready' && resume.segmentation_confirmed === true
      )));
    } catch (error) {
      console.error('Failed to fetch resumes:', error);
    }
  };

  const fetchJobConfigs = async () => {
    try {
      const response = await apiFetch('/api/configs');
      const data = await response.json();
      if (data.configs) {
        setRegions(data.configs.region || []);
        setDirections(data.configs.direction || []);
      }
    } catch (error) {
      console.error('Failed to fetch job configs:', error);
    }
  };

  const handleMatch = async () => {
    if (!selectedResumeId) return;

    setMatching(true);
    setMatchProgress(0);
    setMatchResults([]);
    setMatchError('');

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setMatchProgress((prev) => Math.min(prev + 5, 90));
      }, 100);

      const response = await apiFetch('/api/ai/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          resumeId: selectedResumeId,
          regions: selectedRegions,
          directions: selectedDirections,
        }),
      });

      clearInterval(progressInterval);
      setMatchProgress(100);

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'AI匹配失败，请重试');
      }
      setMatchResults(data.matches || []);

      setTimeout(() => {
        setMatchProgress(0);
      }, 1000);
    } catch (error) {
      console.error('Match failed:', error);
      setMatchError(error instanceof Error ? error.message : 'AI匹配失败，请重试');
    } finally {
      setMatching(false);
    }
  };

  const getScoreLabel = (score: number) => {
    if (score >= 80) return t('aiMatch.scoreHigh');
    if (score >= 60) return t('aiMatch.scoreMedium');
    return t('aiMatch.scoreLow');
  };

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <Header1 />
      <main className="relative container mx-auto px-4 pt-16 md:pt-20 pb-16">
        {/* Hero：左对齐 eyebrow + 大标题（Tailark 式） */}
        <div className="relative mb-8 md:mb-10">
          <p className="text-sm font-medium text-zinc-400 dark:text-zinc-500 mb-3">{t('aiMatch.eyebrow')}</p>
          <h1 className="text-2xl md:text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 mb-4">{t('aiMatch.title')}</h1>
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
            <div className="flex flex-wrap items-end gap-3">
              {/* 简历选择 */}
              <div className="w-full md:w-auto">
                <label className="text-xs md:text-sm font-medium mb-1.5 block text-zinc-700 dark:text-zinc-200">{t('aiMatch.selectResume')}</label>
                <Select value={selectedResumeId} onValueChange={setSelectedResumeId}>
                  <SelectTrigger className="h-11 w-full md:w-52 rounded-xl border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
                    <SelectValue placeholder={t('aiMatch.selectResumePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {resumes.map((resume) => (
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
              <div className="flex items-center gap-3 md:ml-auto">
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
                  onClick={handleMatch}
                  disabled={!selectedResumeId || matching}
                  className="h-11 rounded-xl px-6 bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 shadow-md hover:shadow-lg transition-all"
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
          </CardContent>
        </Card>

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
              <Badge className="text-xs bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-0 rounded-full px-3 py-1 hover:bg-zinc-900">{t('aiMatch.total')} {matchResults.length} {t('aiMatch.recommendations')}</Badge>
            </div>

            {matchResults.map((result) => (
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

                      {(result.evidence.length > 0 || result.key_gaps.length > 0) && (
                        <div className="grid gap-3 md:grid-cols-2">
                          {result.evidence.length > 0 && (
                            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                              <h4 className="mb-1.5 text-sm font-medium text-emerald-900 dark:text-emerald-200">{t('aiMatch.evidence')}</h4>
                              <ul className="list-disc space-y-1 pl-4 text-xs text-emerald-800 dark:text-emerald-300">
                                {result.evidence.map((item) => <li key={item}>{item}</li>)}
                              </ul>
                            </div>
                          )}
                          {result.key_gaps.length > 0 && (
                            <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
                              <h4 className="mb-1.5 text-sm font-medium text-amber-900 dark:text-amber-200">{t('aiMatch.keyGaps')}</h4>
                              <ul className="list-disc space-y-1 pl-4 text-xs text-amber-800 dark:text-amber-300">
                                {result.key_gaps.map((item) => <li key={item}>{item}</li>)}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Button size="sm" asChild className="h-9 text-xs rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 border-0">
                          <Link href={`/optimize?resumeId=${selectedResumeId}&jobId=${result.job_id}&company=${encodeURIComponent(result.company)}&position=${encodeURIComponent(result.job_title)}&suggestions=${encodeURIComponent(result.suggestions || '')}`}>
                            <Wand2 className="mr-1 h-3 w-3" />
                            {t('aiMatch.optimizeResume')}
                          </Link>
                        </Button>
                        <Button size="sm" variant="outline" asChild className="h-9 text-xs rounded-xl border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                          <Link href={`/jobs/${result.job_id}`}>
                            {t('aiMatch.viewJob')}
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!matching && matchResults.length === 0 && (
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
