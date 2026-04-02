'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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

interface Resume {
  id: number;
  file_name: string;
  user_info: {
    name?: string;
    skills?: string[];
  };
}

interface JobConfig {
  id: number;
  config_type: string;
  config_value: string;
  sort_order: number;
  is_active: boolean;
}

interface MatchResult {
  job_id: number;
  job_title: string;
  company: string;
  match_score: number;
  match_reason: string;
  suggestions: string;
}

// 多选筛选器组件
function MultiSelectChip({
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
  const [isOpen, setIsOpen] = useState(false);
  
  const handleToggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter(v => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button 
          className={`
            w-full inline-flex items-center justify-between gap-2 px-3 py-2.5 
            rounded-xl text-sm font-medium border
            transition-all duration-300
            ${selected.length > 0 
              ? 'bg-primary text-primary-foreground border-primary shadow-md' 
              : 'bg-white border-gray-200 hover:border-primary/30 hover:shadow-sm'
            }
          `}
        >
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${selected.length > 0 ? 'text-primary-foreground' : 'text-gray-400'}`} />
            <span>{label}</span>
            {selected.length > 0 && (
              <Badge variant="secondary" className="bg-white/20 text-primary-foreground h-5 px-1.5 text-xs">
                {selected.length}
              </Badge>
            )}
          </div>
          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''} ${selected.length > 0 ? 'text-primary-foreground/70' : 'text-gray-400'}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2" align="start">
        <div className="max-h-56 overflow-y-auto space-y-1">
          {options.map((option) => {
            const isSelected = selected.includes(option.config_value);
            return (
              <button
                key={option.id}
                onClick={() => handleToggle(option.config_value)}
                className={`
                  w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
                  transition-all duration-200
                  ${isSelected 
                    ? 'bg-primary text-primary-foreground' 
                    : 'hover:bg-gray-100 text-gray-700'
                  }
                `}
                translate="no"
              >
                <div className={`
                  flex items-center justify-center w-4 h-4 rounded border 
                  transition-all duration-200
                  ${isSelected 
                    ? 'bg-white border-white' 
                    : 'border-gray-300'
                  }
                `}>
                  {isSelected && <svg className="w-3 h-3 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                </div>
                <span>{option.config_value}</span>
              </button>
            );
          })}
        </div>
        {selected.length > 0 && (
          <div className="border-t mt-2 pt-2">
            <button
              onClick={() => onChange([])}
              className="w-full text-center text-xs text-gray-500 hover:text-primary py-1 transition-colors"
            >
              清除选择
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default function AIMatchPage() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<string>('');
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedDirections, setSelectedDirections] = useState<string[]>([]);
  const [regions, setRegions] = useState<JobConfig[]>([]);
  const [directions, setDirections] = useState<JobConfig[]>([]);
  const [matching, setMatching] = useState(false);
  const [matchProgress, setMatchProgress] = useState(0);
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);

  useEffect(() => {
    fetchResumes();
    fetchConfigs();
  }, []);

  const fetchResumes = async () => {
    try {
      const response = await fetch('/api/resume');
      const data = await response.json();
      setResumes(data.resumes || []);
    } catch (error) {
      console.error('Failed to fetch resumes:', error);
    }
  };

  const fetchConfigs = async () => {
    try {
      const response = await fetch('/api/configs');
      const data = await response.json();
      setRegions(data.configs?.region || []);
      setDirections(data.configs?.direction || []);
    } catch (error) {
      console.error('Failed to fetch configs:', error);
    }
  };

  const handleMatch = async () => {
    if (!selectedResumeId) return;

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
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Briefcase className="h-6 w-6 text-primary" />
            <span className="font-bold text-xl">PathUp</span>
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/jobs">
              <Button variant="ghost" size="sm">岗位查询</Button>
            </Link>
            <Link href="/resume">
              <Button variant="ghost" size="sm">简历管理</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Page Title */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
            <Brain className="h-8 w-8 text-purple-600" />
            AI智能选岗
          </h1>
          <p className="text-muted-foreground">
            基于你的简历，AI将智能分析并推荐最匹配的岗位
          </p>
        </div>

        {/* Match Form */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              开始匹配
            </CardTitle>
            <CardDescription>
              选择一份简历，AI将分析你的技能和经验，匹配最合适的岗位
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="lg:col-span-2">
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">选择简历</label>
                <Select value={selectedResumeId} onValueChange={setSelectedResumeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择简历" />
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
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">目标地区</label>
                <MultiSelectChip
                  label="地区"
                  icon={MapPin}
                  options={regions}
                  selected={selectedRegions}
                  onChange={setSelectedRegions}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">岗位方向</label>
                <MultiSelectChip
                  label="方向"
                  icon={Compass}
                  options={directions}
                  selected={selectedDirections}
                  onChange={setSelectedDirections}
                />
              </div>
            </div>
            
            {/* 已选筛选条件 */}
            {(selectedRegions.length > 0 || selectedDirections.length > 0) && (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">已选筛选：</span>
                {selectedRegions.map(r => (
                  <Badge key={r} variant="secondary" className="gap-1">
                    <MapPin className="h-3 w-3" />
                    {r}
                    <button onClick={() => setSelectedRegions(selectedRegions.filter(v => v !== r))} className="ml-1 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {selectedDirections.map(d => (
                  <Badge key={d} variant="secondary" className="gap-1">
                    <Compass className="h-3 w-3" />
                    {d}
                    <button onClick={() => setSelectedDirections(selectedDirections.filter(v => v !== d))} className="ml-1 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <button 
                  onClick={() => { setSelectedRegions([]); setSelectedDirections([]); }}
                  className="text-xs text-muted-foreground hover:text-primary"
                >
                  清除全部
                </button>
              </div>
            )}
            
            <div className="mt-4 flex justify-end">
              <Button 
                onClick={handleMatch} 
                disabled={!selectedResumeId || matching}
                className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 min-w-[140px]"
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

            {matching && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">正在分析简历并匹配岗位...</span>
                  <span className="text-sm font-medium">{matchProgress}%</span>
                </div>
                <Progress value={matchProgress} className="h-2" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Match Results */}
        {matchResults.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                匹配结果
              </h2>
              <Badge variant="secondary">共 {matchResults.length} 个推荐</Badge>
            </div>

            {matchResults.map((result, index) => (
              <Card key={result.job_id} className="hover:shadow-lg transition-all">
                <CardContent className="pt-6">
                  <div className="flex flex-col md:flex-row gap-6">
                    {/* Score */}
                    <div className="flex flex-col items-center justify-center p-4 rounded-lg bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950 dark:to-blue-950">
                      <div className={`text-4xl font-bold ${getScoreColor(result.match_score)}`}>
                        {result.match_score}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">匹配分数</div>
                      <Badge className="mt-2" variant={result.match_score >= 80 ? 'default' : 'secondary'}>
                        {getScoreLabel(result.match_score)}
                      </Badge>
                    </div>

                    {/* Details */}
                    <div className="flex-1 space-y-4">
                      <div>
                        <h3 className="text-lg font-semibold">{result.job_title}</h3>
                        <p className="text-muted-foreground">{result.company}</p>
                      </div>

                      <div>
                        <h4 className="font-medium flex items-center gap-2 mb-2">
                          <TrendingUp className="h-4 w-4 text-green-600" />
                          匹配原因
                        </h4>
                        <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                          {result.match_reason}
                        </p>
                      </div>

                      {result.suggestions && (
                        <div>
                          <h4 className="font-medium flex items-center gap-2 mb-2">
                            <Sparkles className="h-4 w-4 text-orange-600" />
                            优化建议
                          </h4>
                          <p className="text-sm text-muted-foreground bg-orange-50 dark:bg-orange-950/30 p-3 rounded-lg">
                            {result.suggestions}
                          </p>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Button size="sm" asChild>
                          <Link href={`/jobs/${result.job_id}`}>
                            查看岗位
                          </Link>
                        </Button>
                        <Button size="sm" asChild variant="outline" className="bg-gradient-to-r from-orange-50 to-amber-50 border-orange-200 hover:from-orange-100 hover:to-amber-100 text-orange-700">
                          <Link href={`/optimize?resumeId=${selectedResumeId}&company=${encodeURIComponent(result.company)}&position=${encodeURIComponent(result.job_title)}&suggestions=${encodeURIComponent(result.suggestions || '')}`}>
                            <Wand2 className="mr-1.5 h-4 w-4" />
                            一键优化简历
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
            <CardContent className="py-12 text-center">
              <Brain className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium mb-2">选择简历开始匹配</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                AI将分析你的简历内容，结合岗位要求，为你推荐最匹配的工作机会
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
