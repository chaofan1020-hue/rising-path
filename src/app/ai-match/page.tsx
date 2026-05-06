'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAccessCode } from '@/components/access-guard';
import { AccessGuard } from '@/components/access-guard';
import { StepProgressBar } from '@/components/step-progress-bar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Brain, Sparkles, Target, MapPin, Compass, ChevronDown,
  CheckCircle, TrendingUp, Loader2, X, ArrowRight, FileText
} from 'lucide-react';

interface Resume {
  id: number;
  file_name: string;
  user_info?: { name?: string };
}

interface JobConfig {
  id: number;
  config_value: string;
}

interface MatchResult {
  job_id: number;
  job_title: string;
  company: string;
  match_score: number;
  match_reason: string;
  suggestions?: string;
}

// 多选筛选器组件
function MultiSelectFilter({ label, icon: Icon, options, selected, onChange }: {
  label: string;
  icon: React.ElementType;
  options: JobConfig[];
  selected: string[];
  onChange: (val: string[]) => void;
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
        <button className="flex items-center gap-1.5 px-3 py-2 border rounded-md text-sm hover:bg-muted transition-colors h-10">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{label}</span>
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
          <div className="text-center py-2 text-sm text-muted-foreground">暂无选项</div>
        )}
        {selected.length > 0 && (
          <div className="border-t mt-2 pt-2">
            <button
              onClick={() => onChange([])}
              className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
            >
              清除全部
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// 内部组件
function AIMatchContent() {
  const router = useRouter();
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<string>('');
  const [matching, setMatching] = useState(false);
  const [matchProgress, setMatchProgress] = useState(0);
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [selectedJobs, setSelectedJobs] = useState<Set<number>>(new Set());
  const { accessCodeId } = useAccessCode();
  
  // 筛选相关状态
  const [regions, setRegions] = useState<JobConfig[]>([]);
  const [directions, setDirections] = useState<JobConfig[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedDirections, setSelectedDirections] = useState<string[]>([]);

  // 从 localStorage 恢复数据
  useEffect(() => {
    const saved = localStorage.getItem('risingpath_step2_data');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.selectedResumeId) setSelectedResumeId(data.selectedResumeId);
        if (data.matchResults) setMatchResults(data.matchResults);
        if (data.selectedJobs) setSelectedJobs(new Set(data.selectedJobs));
        if (data.selectedRegions) setSelectedRegions(data.selectedRegions);
        if (data.selectedDirections) setSelectedDirections(data.selectedDirections);
      } catch (e) {
        console.error('Failed to restore step2 data:', e);
      }
    }
  }, []);

  // 保存数据到 localStorage
  useEffect(() => {
    if (matchResults.length > 0 || selectedResumeId) {
      localStorage.setItem('risingpath_step2_data', JSON.stringify({
        selectedResumeId,
        matchResults,
        selectedJobs: Array.from(selectedJobs),
        selectedRegions,
        selectedDirections,
      }));
    }
  }, [selectedResumeId, matchResults, selectedJobs, selectedRegions, selectedDirections]);

  useEffect(() => {
    if (accessCodeId) {
      fetchResumes();
      fetchJobConfigs();
    }
  }, [accessCodeId]);

  // 恢复 step1 选中的简历
  useEffect(() => {
    const step1Data = localStorage.getItem('risingpath_step1_data');
    if (step1Data && !selectedResumeId) {
      try {
        const data = JSON.parse(step1Data);
        if (data.resumeId) {
          setSelectedResumeId(data.resumeId.toString());
        }
      } catch (e) {}
    }
  }, []);

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
    setSelectedJobs(new Set());

    try {
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

  const toggleJobSelection = (jobId: number) => {
    setSelectedJobs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(jobId)) {
        newSet.delete(jobId);
      } else {
        newSet.add(jobId);
      }
      return newSet;
    });
  };

  const selectAllJobs = () => {
    setSelectedJobs(new Set(matchResults.map(r => r.job_id)));
  };

  const deselectAllJobs = () => {
    setSelectedJobs(new Set());
  };

  const handleConfirmAndNext = () => {
    if (selectedJobs.size === 0) return;
    
    // 保存选中岗位信息
    const selectedJobDetails = matchResults
      .filter(r => selectedJobs.has(r.job_id))
      .map(r => ({
        job_id: r.job_id,
        job_title: r.job_title,
        company: r.company,
        match_score: r.match_score,
        match_reason: r.match_reason,
        suggestions: r.suggestions,
      }));
    
    localStorage.setItem('risingpath_step3_jobs', JSON.stringify(selectedJobDetails));
    router.push('/optimize?step=3');
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreLabel = (score: number) => {
    if (score >= 80) return '高度匹配';
    if (score >= 60) return '中等匹配';
    return '匹配度较低';
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.svg" alt="Rising Path" width={28} height={28} className="rounded" />
            <span className="font-bold text-lg md:text-xl">Rising Path</span>
          </Link>
        </div>
      </header>

      {/* Step Progress Bar */}
      <div className="border-b bg-muted/30">
        <div className="container mx-auto px-4 py-3">
          <StepProgressBar currentStep={2} />
        </div>
      </div>

      <main className="container mx-auto px-4 py-4 md:py-8 max-w-5xl">
        {/* Page Title */}
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-1 md:mb-2 flex items-center gap-2 md:gap-3">
            <Brain className="h-6 w-6 md:h-8 md:w-8 text-purple-600" />
            AI智能选岗
          </h1>
          <p className="text-sm md:text-base text-muted-foreground">
            基于你的简历，AI将智能分析并推荐最匹配的岗位，勾选你感兴趣的岗位进入下一步
          </p>
        </div>

        {/* Match Form */}
        <Card className="mb-6 md:mb-8">
          <CardHeader className="pb-2 md:pb-4">
            <CardTitle className="flex items-center gap-2 text-base md:text-lg">
              <Target className="h-4 w-4 md:h-5 md:w-5" />
              开始匹配
            </CardTitle>
            <CardDescription className="text-xs md:text-sm">
              选择一份简历，AI将分析你的技能和经验，匹配最合适的岗位
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full md:w-auto">
                <label className="text-xs md:text-sm font-medium mb-1.5 block">选择简历</label>
                <Select value={selectedResumeId} onValueChange={setSelectedResumeId}>
                  <SelectTrigger className="h-10 w-full md:w-48">
                    <SelectValue placeholder="选择要匹配的简历" />
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

              <div className="flex items-center gap-3 md:ml-auto">
                <MultiSelectFilter
                  label="地区"
                  icon={MapPin}
                  options={regions}
                  selected={selectedRegions}
                  onChange={setSelectedRegions}
                />
                <MultiSelectFilter
                  label="方向"
                  icon={Compass}
                  options={directions}
                  selected={selectedDirections}
                  onChange={setSelectedDirections}
                />
                <Button
                  onClick={handleMatch}
                  disabled={!selectedResumeId || matching}
                  className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 h-10"
                >
                  {matching ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      匹配中...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      开始AI匹配
                    </>
                  )}
                </Button>
              </div>
            </div>

            {(selectedRegions.length > 0 || selectedDirections.length > 0) && (
              <div className="mt-4 flex flex-wrap gap-1.5 md:gap-2 items-center">
                <span className="text-xs md:text-sm text-muted-foreground">已选择：</span>
                {selectedRegions.map((region) => (
                  <Badge key={region} variant="secondary" className="flex items-center gap-1 pr-1 text-xs">
                    <MapPin className="h-3 w-3" />
                    {region}
                    <button onClick={() => setSelectedRegions(selectedRegions.filter(r => r !== region))} className="ml-1 hover:bg-muted-foreground/20 rounded-full p-0.5">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {selectedDirections.map((direction) => (
                  <Badge key={direction} variant="secondary" className="flex items-center gap-1 pr-1 text-xs">
                    <Compass className="h-3 w-3" />
                    {direction}
                    <button onClick={() => setSelectedDirections(selectedDirections.filter(d => d !== direction))} className="ml-1 hover:bg-muted-foreground/20 rounded-full p-0.5">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <button onClick={() => { setSelectedRegions([]); setSelectedDirections([]); }} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                  清除全部
                </button>
              </div>
            )}

            {matching && (
              <div className="mt-4 md:mt-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs md:text-sm text-muted-foreground">正在分析简历并匹配岗位...</span>
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
            {/* Selection Controls */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <h2 className="text-lg md:text-xl font-semibold flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 md:h-5 md:w-5 text-green-600" />
                  匹配结果
                </h2>
                <Badge variant="secondary" className="text-xs">共 {matchResults.length} 个推荐</Badge>
                {selectedJobs.size > 0 && (
                  <Badge className="bg-purple-600 text-xs">已选 {selectedJobs.size} 个</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={selectAllJobs} className="text-xs h-8">
                  全选
                </Button>
                <Button variant="outline" size="sm" onClick={deselectAllJobs} className="text-xs h-8">
                  取消全选
                </Button>
              </div>
            </div>

            {matchResults.map((result) => (
              <Card 
                key={result.job_id} 
                className={`hover:shadow-lg transition-all cursor-pointer ${
                  selectedJobs.has(result.job_id) ? 'ring-2 ring-purple-500 bg-purple-50/50 dark:bg-purple-950/20' : ''
                }`}
                onClick={() => toggleJobSelection(result.job_id)}
              >
                <CardContent className="pt-4 md:pt-6">
                  <div className="flex flex-col md:flex-row gap-4 md:gap-6">
                    {/* Checkbox */}
                    <div className="flex items-start pt-1">
                      <Checkbox
                        checked={selectedJobs.has(result.job_id)}
                        onCheckedChange={() => toggleJobSelection(result.job_id)}
                        className="data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600 h-5 w-5"
                      />
                    </div>

                    {/* Score */}
                    <div className="flex items-center gap-3 md:flex-col md:items-center md:justify-center md:p-4 md:rounded-lg md:bg-gradient-to-br md:from-purple-50 md:to-blue-50 dark:md:from-purple-950 dark:md:to-blue-950 flex-shrink-0">
                      <div className={`text-3xl md:text-4xl font-bold ${getScoreColor(result.match_score)}`}>
                        {result.match_score}
                      </div>
                      <div className="flex flex-col gap-0.5 md:gap-1 md:items-center">
                        <div className="text-xs md:text-sm text-muted-foreground">匹配分数</div>
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
                          匹配原因
                        </h4>
                        <p className="text-xs md:text-sm text-muted-foreground bg-muted/50 p-2.5 md:p-3 rounded-lg">
                          {result.match_reason}
                        </p>
                      </div>

                      {result.suggestions && (
                        <div>
                          <h4 className="font-medium flex items-center gap-2 mb-1.5 md:mb-2 text-sm md:text-base">
                            <Sparkles className="h-3.5 w-3.5 md:h-4 md:w-4 text-orange-600" />
                            优化建议
                          </h4>
                          <p className="text-xs md:text-sm text-muted-foreground bg-orange-50 dark:bg-orange-950/30 p-2.5 md:p-3 rounded-lg">
                            {result.suggestions}
                          </p>
                        </div>
                      )}

                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="outline" asChild className="h-8 text-xs">
                          <Link href={`/jobs/${result.job_id}`}>
                            <FileText className="mr-1 h-3 w-3" />
                            查看详情
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Confirm & Next Button */}
            <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t py-4 -mx-4 px-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  {selectedJobs.size > 0 ? (
                    <span>已选择 <strong className="text-foreground">{selectedJobs.size}</strong> 个岗位</span>
                  ) : (
                    <span>请勾选你感兴趣的岗位</span>
                  )}
                </div>
                <Button
                  onClick={handleConfirmAndNext}
                  disabled={selectedJobs.size === 0}
                  className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                  size="lg"
                >
                  确认选岗，进入ATS优化
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!matching && matchResults.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-8 md:py-12 text-center">
              <Brain className="h-12 w-12 md:h-16 md:w-16 mx-auto mb-3 md:mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-base md:text-lg font-medium mb-1.5 md:mb-2">选择简历开始匹配</h3>
              <p className="text-xs md:text-sm text-muted-foreground max-w-md mx-auto px-4">
                AI将分析你的简历内容，结合岗位要求，为你推荐最匹配的工作机会
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

export default function AIMatchPage() {
  return (
    <AccessGuard>
      <AIMatchContent />
    </AccessGuard>
  );
}
