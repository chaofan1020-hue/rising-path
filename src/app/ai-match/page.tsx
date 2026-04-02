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
        <button className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:border-purple-300 hover:bg-purple-50/50 transition-all text-sm shadow-sm">
          <Icon className="h-4 w-4 text-purple-500" />
          <span className="font-medium text-gray-700">{label}</span>
          {selected.length > 0 && (
            <Badge className="ml-0.5 h-5 px-2 rounded-full bg-gradient-to-r from-purple-500 to-blue-500 text-white border-0 text-xs font-semibold">
              {selected.length}
            </Badge>
          )}
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2 rounded-xl shadow-xl border-slate-200" align="start">
        <div className="max-h-60 overflow-y-auto space-y-0.5">
          {options.map((option) => (
            <label
              key={option.id}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                selected.includes(option.config_value) 
                  ? 'bg-gradient-to-r from-purple-50 to-blue-50 text-purple-700' 
                  : 'hover:bg-slate-50'
              }`}
              translate="no"
            >
              <Checkbox
                checked={selected.includes(option.config_value)}
                onCheckedChange={() => handleToggle(option.config_value)}
                className="data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-purple-500 data-[state=checked]:to-blue-500 data-[state=checked]:border-0"
              />
              <span className="text-sm font-medium">{option.config_value}</span>
            </label>
          ))}
        </div>
        {options.length === 0 && (
          <div className="text-center py-4 text-sm text-muted-foreground">暂无选项</div>
        )}
        {selected.length > 0 && (
          <div className="border-t border-slate-100 mt-2 pt-2">
            <button
              onClick={() => onChange([])}
              className="w-full text-xs text-slate-500 hover:text-purple-600 transition-colors py-1.5 rounded-lg hover:bg-purple-50"
            >
              清除全部选择
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
      const response = await fetch('/api/jobs/config');
      const data = await response.json();
      if (data.configs) {
        setRegions(data.configs.filter((c: JobConfig) => c.config_type === 'region'));
        setDirections(data.configs.filter((c: JobConfig) => c.config_type === 'direction'));
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-purple-50/30 to-blue-50/40">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
              <Briefcase className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-xl">PathUp</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link href="/jobs">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">岗位查询</Button>
            </Link>
            <Link href="/resume">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">简历管理</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Hero Section */}
        <div className="relative mb-10">
          <div className="absolute inset-0 bg-gradient-to-r from-purple-600/10 to-blue-600/10 rounded-3xl blur-3xl" />
          <div className="relative text-center py-10">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-600 to-blue-600 shadow-xl shadow-purple-500/25 mb-6">
              <Brain className="h-10 w-10 text-white" />
            </div>
            <h1 className="text-4xl font-bold mb-3 bg-gradient-to-r from-gray-900 via-purple-800 to-gray-900 bg-clip-text text-transparent">
              AI智能选岗
            </h1>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              基于你的简历，AI将智能分析并推荐最匹配的岗位
            </p>
          </div>
        </div>

        {/* Match Form Card */}
        <Card className="max-w-3xl mx-auto mb-8 border-0 shadow-xl shadow-slate-200/50 bg-white/80 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center">
                <Target className="h-4 w-4 text-purple-600" />
              </div>
              开始匹配
            </CardTitle>
            <CardDescription className="pl-10">
              选择简历和筛选条件，AI将为你精准匹配
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* 简历选择 */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-xs font-bold">1</span>
                选择简历
              </label>
              <Select value={selectedResumeId} onValueChange={setSelectedResumeId}>
                <SelectTrigger className="h-12 bg-white border-slate-200 hover:border-purple-300 transition-colors">
                  <SelectValue placeholder="选择要匹配的简历文件" />
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

            {/* 筛选条件 */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">2</span>
                筛选条件
                <span className="text-xs text-muted-foreground font-normal">（可选，多选）</span>
              </label>
              <div className="flex flex-wrap gap-3">
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
            </div>

            {/* 匹配按钮 */}
            <div className="pt-2">
              <Button 
                onClick={handleMatch} 
                disabled={!selectedResumeId || matching}
                size="lg"
                className="w-full h-12 text-base font-semibold bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 shadow-lg shadow-purple-500/25 transition-all disabled:opacity-50"
              >
                {matching ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    AI正在分析中...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-5 w-5" />
                    开始AI匹配
                  </>
                )}
              </Button>
            </div>

            {/* Progress Bar */}
            {matching && (
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">正在分析简历并匹配岗位...</span>
                  <span className="font-semibold text-purple-600">{matchProgress}%</span>
                </div>
                <Progress value={matchProgress} className="h-2 bg-purple-100 [&>div]:bg-gradient-to-r [&>div]:from-purple-500 [&>div]:to-blue-500" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Match Results */}
        {matchResults.length > 0 && (
          <div className="max-w-3xl mx-auto space-y-4">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                匹配结果
              </h2>
              <Badge variant="secondary" className="bg-purple-100 text-purple-700 border-0">
                共 {matchResults.length} 个推荐
              </Badge>
            </div>

            {matchResults.map((result) => (
              <Card key={result.job_id} className="border-0 shadow-lg shadow-slate-200/50 bg-white/80 backdrop-blur-sm hover:shadow-xl hover:shadow-purple-200/30 transition-all duration-300">
                <CardContent className="pt-6">
                  <div className="flex flex-col md:flex-row gap-6">
                    {/* Score Circle */}
                    <div className="flex flex-col items-center justify-center p-6 rounded-2xl bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 min-w-[120px]">
                      <div className={`text-5xl font-bold ${getScoreColor(result.match_score)}`}>
                        {result.match_score}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">匹配分数</div>
                      <Badge 
                        className="mt-3 border-0 font-medium" 
                        style={{
                          background: result.match_score >= 80 
                            ? 'linear-gradient(135deg, #10b981, #059669)' 
                            : result.match_score >= 60 
                              ? 'linear-gradient(135deg, #f59e0b, #d97706)' 
                              : 'linear-gradient(135deg, #ef4444, #dc2626)',
                          color: 'white'
                        }}
                      >
                        {getScoreLabel(result.match_score)}
                      </Badge>
                    </div>

                    {/* Details */}
                    <div className="flex-1 space-y-4">
                      <div>
                        <h3 className="text-xl font-semibold text-gray-900">{result.job_title}</h3>
                        <p className="text-muted-foreground mt-0.5">{result.company}</p>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-2">
                            <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center">
                              <TrendingUp className="h-3 w-3 text-green-600" />
                            </div>
                            匹配原因
                          </h4>
                          <p className="text-sm text-muted-foreground bg-slate-50 p-3 rounded-xl leading-relaxed">
                            {result.match_reason}
                          </p>
                        </div>

                        {result.suggestions && (
                          <div>
                            <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-2">
                              <div className="w-5 h-5 rounded-full bg-orange-100 flex items-center justify-center">
                                <Sparkles className="h-3 w-3 text-orange-600" />
                              </div>
                              优化建议
                            </h4>
                            <p className="text-sm text-muted-foreground bg-gradient-to-r from-orange-50 to-amber-50 p-3 rounded-xl leading-relaxed">
                              {result.suggestions}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-3 pt-2">
                        <Button size="sm" className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700" asChild>
                          <Link href={`/jobs/${result.job_id}`}>
                            查看岗位详情
                          </Link>
                        </Button>
                        <Button size="sm" variant="outline" className="border-purple-200 text-purple-700 hover:bg-purple-50">
                          立即申请
                          <ArrowRight className="ml-2 h-4 w-4" />
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
          <Card className="max-w-3xl mx-auto border-0 bg-white/60 backdrop-blur-sm">
            <CardContent className="py-16 text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 mb-6">
                <Brain className="h-10 w-10 text-slate-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">选择简历开始匹配</h3>
              <p className="text-muted-foreground max-w-md mx-auto leading-relaxed">
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
