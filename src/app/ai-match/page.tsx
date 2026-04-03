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
import { AccessGuard, useAccessCode } from '@/components/access-guard';

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
}: {
  label: string;
  icon: React.ElementType;
  options: JobConfig[];
  selected: string[];
  onChange: (values: string[]) => void;
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
        <button className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors text-sm">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{label}</span>
          {selected.length > 0 && (
            <Badge variant="secondary" className="ml-0.5 h-5 px-1.5 rounded-full">
              {selected.length}
            </Badge>
          )}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2" align="start">
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
    if (score >= 80) return '高度匹配';
    if (score >= 60) return '中等匹配';
    return '匹配度较低';
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur z-50">
        <div className="container mx-auto px-4 h-14 md:h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 md:h-6 md:w-6 text-primary" />
            <span className="font-bold text-lg md:text-xl">PathUp</span>
          </Link>
          <nav className="flex items-center gap-2 md:gap-4">
            <Link href="/jobs">
              <Button variant="ghost" size="sm" className="text-xs md:text-sm">岗位查询</Button>
            </Link>
            <Link href="/resume">
              <Button variant="ghost" size="sm" className="text-xs md:text-sm">简历管理</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="container mx-auto px-4 py-4 md:py-8">
        {/* Page Title */}
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-1 md:mb-2 flex items-center gap-2 md:gap-3">
            <Brain className="h-6 w-6 md:h-8 md:w-8 text-purple-600" />
            AI智能选岗
          </h1>
          <p className="text-sm md:text-base text-muted-foreground">
            基于你的简历，AI将智能分析并推荐最匹配的岗位
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
            <div className="flex flex-col gap-4">
              {/* 简历选择 */}
              <div className="w-full md:max-w-md">
                <label className="text-xs md:text-sm font-medium mb-1.5 md:mb-2 block">选择简历</label>
                <Select value={selectedResumeId} onValueChange={setSelectedResumeId}>
                  <SelectTrigger className="h-9 md:h-10">
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

              {/* 筛选条件 + 匹配按钮 */}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex flex-wrap gap-2">
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
                </div>
                <Button 
                  onClick={handleMatch} 
                  disabled={!selectedResumeId || matching}
                  className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 w-full sm:w-auto h-9 md:h-10"
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

            {/* 已选择的筛选条件显示 */}
            {(selectedRegions.length > 0 || selectedDirections.length > 0) && (
              <div className="mt-4 flex flex-wrap gap-1.5 md:gap-2 items-center">
                <span className="text-xs md:text-sm text-muted-foreground">已选择：</span>
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
            <div className="flex items-center justify-between">
              <h2 className="text-lg md:text-xl font-semibold flex items-center gap-2">
                <CheckCircle className="h-4 w-4 md:h-5 md:w-5 text-green-600" />
                匹配结果
              </h2>
              <Badge variant="secondary" className="text-xs">共 {matchResults.length} 个推荐</Badge>
            </div>

            {matchResults.map((result, index) => (
              <Card key={result.job_id} className="hover:shadow-lg transition-all">
                <CardContent className="pt-4 md:pt-6">
                  <div className="flex flex-col gap-4 md:gap-6">
                    {/* Score - 手机端横向，桌面端可能保持横向或调整 */}
                    <div className="flex items-center gap-4 md:flex-col md:items-center md:justify-center md:p-4 md:rounded-lg md:bg-gradient-to-br md:from-purple-50 md:to-blue-50 dark:md:from-purple-950 dark:md:to-blue-950">
                      <div className={`text-3xl md:text-4xl font-bold ${getScoreColor(result.match_score)}`}>
                        {result.match_score}
                      </div>
                      <div className="flex flex-col gap-1 md:items-center">
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

                      <div className="flex gap-2">
                        <Button size="sm" asChild className="h-8 text-xs">
                          <Link href={`/optimize?resumeId=${selectedResumeId}&company=${encodeURIComponent(result.company)}&position=${encodeURIComponent(result.job_title)}&suggestions=${encodeURIComponent(result.suggestions || '')}`}>
                            <Wand2 className="mr-1 h-3 w-3" />
                            优化简历
                          </Link>
                        </Button>
                        <Button size="sm" variant="outline" asChild className="h-8 text-xs">
                          <Link href={`/jobs/${result.job_id}`}>
                            查看岗位
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

// 主组件
export default function AIMatchPage() {
  return (
    <AccessGuard>
      <AIMatchContent />
    </AccessGuard>
  );
}
