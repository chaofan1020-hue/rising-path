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
  Brain, 
  Target, 
  Loader2, 
  CheckCircle, 
  ArrowRight,
  Briefcase,
  Sparkles,
  TrendingUp,
  MapPin,
  Compass,
  ChevronDown,
  X,
  Wand2,
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { AccessGuard, useAccessCode } from '@/components/access-guard';
import { Header1 } from '@/components/header1';
import { useLanguage } from '@/lib/language-context';

interface Resume {
  id: number;
  file_name: string;
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
  icon: React.ElementType;
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
        <button className="inline-flex items-center gap-1.5 md:gap-2 px-2.5 py-1.5 md:px-3 md:py-2 rounded-full hover:bg-accent hover:text-accent-foreground transition-colors text-xs md:text-sm">
          <Icon className="h-3.5 w-3.5 md:h-4 md:w-4 text-muted-foreground" />
          <span className="font-medium">{label}</span>
          {selected.length > 0 && (
            <Badge variant="secondary" className="ml-0.5 h-4 md:h-5 px-1 md:px-1.5 rounded-full text-[10px] md:text-xs">
              {selected.length}
            </Badge>
          )}
          <ChevronDown className="h-3 w-3 md:h-3.5 md:w-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-44 md:w-48 p-2" align="start">
        <div className="max-h-60 overflow-y-auto space-y-1">
          {options.map((option) => (
            <label
              key={option.id}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
                selected.includes(option.config_value) 
                  ? 'bg-primary/10 text-primary' 
                  : 'hover:bg-muted'
              }`}
              translate="no"
            >
              <Checkbox
                checked={selected.includes(option.config_value)}
                onCheckedChange={() => handleToggle(option.config_value)}
                className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
              />
              <span className="text-sm font-medium">{option.config_value}</span>
            </label>
          ))}
        </div>
        {options.length === 0 && (
          <div className="text-center py-2 text-sm text-muted-foreground">{t('aiMatch.noOptions')}</div>
        )}
        {selected.length > 0 && (
          <div className="border-t mt-2 pt-2">
            <button
              onClick={() => onChange([])}
              className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
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
  const { accessCodeId } = useAccessCode();
  
  // 筛选相关状态
  const [regions, setRegions] = useState<JobConfig[]>([]);
  const [directions, setDirections] = useState<JobConfig[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedDirections, setSelectedDirections] = useState<string[]>([]);

  useEffect(() => {
    if (accessCodeId) {
      fetchResumes();
      fetchJobConfigs();
    }
  }, [accessCodeId]);

  const fetchResumes = async () => {
    if (!accessCodeId) return;
    try {
      const params = new URLSearchParams();
      params.append('access_code_id', accessCodeId.toString());
      const response = await fetch(`/api/resume?${params.toString()}`);
      const data = await response.json();
      setResumes(data.resumes || []);
    } catch (error) {
      console.error('Failed to fetch resumes:', error);
    }
  };

  const fetchJobConfigs = async () => {
    try {
      const response = await fetch('/api/configs');
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
    if (!selectedResumeId || !accessCodeId) return;

    setMatching(true);
    setMatchProgress(0);
    setMatchResults([]);

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setMatchProgress((prev) => Math.min(prev + 5, 90));
      }, 100);

      const response = await fetch('/api/ai/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          resumeId: selectedResumeId,
          accessCodeId: accessCodeId,
          regions: selectedRegions,
          directions: selectedDirections,
        }),
      });

      clearInterval(progressInterval);
      setMatchProgress(100);

      const data = await response.json();
      setMatchResults(data.matches || []);

      setTimeout(() => {
        setMatchProgress(0);
      }, 1000);
    } catch (error) {
      console.error('Match failed:', error);
    } finally {
      setMatching(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreLabel = (score: number) => {
    if (score >= 80) return t('aiMatch.scoreHigh');
    if (score >= 60) return t('aiMatch.scoreMedium');
    return t('aiMatch.scoreLow');
  };

  return (
    <div className="min-h-screen bg-background">
      <Header1 />
      <main className="container mx-auto px-4 py-4 md:py-8 pt-20">
        {/* Page Title */}
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-1 md:mb-2 flex items-center gap-2 md:gap-3 text-black dark:text-white">
            <Brain className="h-6 w-6 md:h-8 md:w-8 text-terracotta-600" />
            {t('aiMatch.title')}
          </h1>
          <p className="text-sm md:text-base text-black dark:text-white">
            {t('aiMatch.subtitle')}
          </p>
        </div>

        {/* Match Form */}
        <Card className="mb-6 md:mb-8">
          <CardHeader className="pb-2 md:pb-4">
            <CardTitle className="flex items-center gap-2 text-base md:text-lg">
              <Target className="h-4 w-4 md:h-5 md:w-5" />
              {t('aiMatch.startMatch')}
            </CardTitle>
            <CardDescription className="text-xs md:text-sm">
              {t('aiMatch.startMatchDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              {/* 简历选择 */}
              <div className="w-full md:w-auto">
                <label className="text-xs md:text-sm font-medium mb-1.5 block">{t('aiMatch.selectResume')}</label>
                <Select value={selectedResumeId} onValueChange={setSelectedResumeId}>
                  <SelectTrigger className="h-10 w-full md:w-48">
                    <SelectValue placeholder={t('aiMatch.selectResumePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {resumes.map((resume) => (
                      <SelectItem key={resume.id} value={resume.id.toString()}>
                        {resume.file_name}
                        {resume.user_info?.name && ` - ${resume.user_info.name}`}
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
                  className="bg-gradient-to-r from-terracotta-600 to-sage-600 hover:from-terracotta-700 hover:to-sage-700 h-10"
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
                <span className="text-xs md:text-sm text-muted-foreground">{t('aiMatch.selected')}</span>
                {selectedRegions.map((region) => (
                  <Badge 
                    key={region} 
                    variant="secondary" 
                    className="flex items-center gap-1 pr-1 text-xs"
                  >
                    <MapPin className="h-3 w-3" />
                    {region}
                    <button
                      onClick={() => setSelectedRegions(selectedRegions.filter(r => r !== region))}
                      className="ml-1 hover:bg-muted-foreground/20 rounded-full p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {selectedDirections.map((direction) => (
                  <Badge 
                    key={direction} 
                    variant="secondary" 
                    className="flex items-center gap-1 pr-1 text-xs"
                  >
                    <Compass className="h-3 w-3" />
                    {direction}
                    <button
                      onClick={() => setSelectedDirections(selectedDirections.filter(d => d !== direction))}
                      className="ml-1 hover:bg-muted-foreground/20 rounded-full p-0.5"
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
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t('aiMatch.clearAll')}
                </button>
              </div>
            )}

            {matching && (
              <div className="mt-4 md:mt-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs md:text-sm text-muted-foreground">{t('aiMatch.analyzing')}</span>
                  <span className="text-xs md:text-sm font-medium">{matchProgress}%</span>
                </div>
                <Progress value={matchProgress} className="h-1.5 md:h-2" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Match Results */}
        {matchResults.length > 0 && (
          <div className="space-y-3 md:space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg md:text-xl font-semibold flex items-center gap-2">
                <CheckCircle className="h-4 w-4 md:h-5 md:w-5 text-green-600" />
                {t('aiMatch.matchResults')}
              </h2>
              <Badge variant="secondary" className="text-xs">{t('aiMatch.total')} {matchResults.length} {t('aiMatch.recommendations')}</Badge>
            </div>

            {matchResults.map((result, index) => (
              <Card key={result.job_id} className="hover:shadow-lg transition-all">
                <CardContent className="pt-4 md:pt-6">
                  {/* 手机端：纵向布局，桌面端：横向布局 */}
                  <div className="flex flex-col md:flex-row gap-4 md:gap-6">
                    {/* Score - 手机端横向紧凑，桌面端纵向带背景 */}
                    <div className="flex items-center gap-3 md:flex-col md:items-center md:justify-center md:p-4 md:rounded-lg md:bg-gradient-to-br md:from-terracotta-50 md:to-beige-50 dark:md:from-terracotta-950 dark:md:to-beige-950 flex-shrink-0">
                      <div className={`text-3xl md:text-4xl font-bold ${getScoreColor(result.match_score)}`}>
                        {result.match_score}
                      </div>
                      <div className="flex flex-col gap-0.5 md:gap-1 md:items-center">
                        <div className="text-xs md:text-sm text-muted-foreground">{t('aiMatch.matchScore')}</div>
                        <Badge className="hidden md:flex" variant={result.match_score >= 80 ? 'default' : 'secondary'}>
                          {getScoreLabel(result.match_score)}
                        </Badge>
                      </div>
                    </div>

                    {/* Details */}
                    <div className="flex-1 space-y-3 md:space-y-4">
                      <div>
                        <h3 className="text-base md:text-lg font-semibold">{result.job_title}</h3>
                        <p className="text-xs md:text-sm text-muted-foreground">{result.company}</p>
                      </div>

                      <div>
                        <h4 className="font-medium flex items-center gap-2 mb-1.5 md:mb-2 text-sm md:text-base">
                          <TrendingUp className="h-3.5 w-3.5 md:h-4 md:w-4 text-green-600" />
                          {t('aiMatch.matchReason')}
                        </h4>
                        <p className="text-xs md:text-sm text-muted-foreground bg-muted/50 p-2.5 md:p-3 rounded-lg">
                          {result.match_reason}
                        </p>
                      </div>

                      {result.suggestions && (
                        <div>
                          <h4 className="font-medium flex items-center gap-2 mb-1.5 md:mb-2 text-sm md:text-base">
                            <Sparkles className="h-3.5 w-3.5 md:h-4 md:w-4 text-orange-600" />
                            {t('aiMatch.suggestions')}
                          </h4>
                          <p className="text-xs md:text-sm text-muted-foreground bg-orange-50 dark:bg-orange-950/30 p-2.5 md:p-3 rounded-lg">
                            {result.suggestions}
                          </p>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Button size="sm" asChild className="h-8 text-xs">
                          <Link href={`/optimize?resumeId=${selectedResumeId}&company=${encodeURIComponent(result.company)}&position=${encodeURIComponent(result.job_title)}&suggestions=${encodeURIComponent(result.suggestions || '')}`}>
                            <Wand2 className="mr-1 h-3 w-3" />
                            {t('aiMatch.optimizeResume')}
                          </Link>
                        </Button>
                        <Button size="sm" variant="outline" asChild className="h-8 text-xs">
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
          <Card className="border-dashed">
            <CardContent className="py-8 md:py-12 text-center">
              <Brain className="h-12 w-12 md:h-16 md:w-16 mx-auto mb-3 md:mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-base md:text-lg font-medium mb-1.5 md:mb-2">{t('aiMatch.emptyTitle')}</h3>
              <p className="text-xs md:text-sm text-muted-foreground max-w-md mx-auto px-4">
                {t('aiMatch.emptyDesc')}
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

// 主组件
export default function AIMatchPage() {
  return (
    <AccessGuard>
      <AIMatchContent />
    </AccessGuard>
  );
}
