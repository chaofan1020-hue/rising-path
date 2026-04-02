'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
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
  Loader2, 
  CheckCircle, 
  ArrowRight,
  Briefcase,
  Sparkles,
  TrendingUp,
  MapPin,
  Compass,
  ChevronDown,
  FileText,
  Zap,
  Target,
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

// 多选筛选器组件 - 简洁版
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
        <button className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-all text-left group">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center group-hover:bg-purple-100 transition-colors">
              <Icon className="h-4 w-4 text-slate-500 group-hover:text-purple-600" />
            </div>
            <div>
              <div className="text-sm font-medium text-gray-900">{label}</div>
              {selected.length > 0 && (
                <div className="text-xs text-purple-600">已选 {selected.length} 项</div>
              )}
            </div>
          </div>
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2 rounded-xl" align="start">
        <div className="max-h-64 overflow-y-auto space-y-1">
          {options.map((option) => (
            <label
              key={option.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                selected.includes(option.config_value) 
                  ? 'bg-purple-50' 
                  : 'hover:bg-slate-50'
              }`}
              translate="no"
            >
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                selected.includes(option.config_value) 
                  ? 'bg-purple-600 border-purple-600' 
                  : 'border-slate-300'
              }`}>
                {selected.includes(option.config_value) && (
                  <CheckCircle className="h-3 w-3 text-white" />
                )}
              </div>
              <span className="text-sm">{option.config_value}</span>
            </label>
          ))}
        </div>
        {options.length === 0 && (
          <div className="text-center py-6 text-sm text-muted-foreground">暂无选项</div>
        )}
        {selected.length > 0 && (
          <div className="border-t mt-2 pt-2">
            <button
              onClick={() => onChange([])}
              className="w-full text-sm text-purple-600 hover:text-purple-700 py-2 rounded-lg hover:bg-purple-50 transition-colors"
            >
              清除选择
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// 结果卡片组件
function ResultCard({ result }: { result: MatchResult }) {
  const getScoreGradient = (score: number) => {
    if (score >= 80) return 'from-emerald-500 to-green-600';
    if (score >= 60) return 'from-amber-500 to-orange-600';
    return 'from-rose-500 to-red-600';
  };

  const getScoreBg = (score: number) => {
    if (score >= 80) return 'bg-emerald-50 border-emerald-100';
    if (score >= 60) return 'bg-amber-50 border-amber-100';
    return 'bg-rose-50 border-rose-100';
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 hover:shadow-lg hover:border-slate-300 transition-all duration-300">
      <div className="flex gap-5">
        {/* 分数圆环 */}
        <div className={`flex-shrink-0 w-20 h-20 rounded-2xl ${getScoreBg(result.match_score)} border flex flex-col items-center justify-center`}>
          <span className={`text-2xl font-bold bg-gradient-to-br ${getScoreGradient(result.match_score)} bg-clip-text text-transparent`}>
            {result.match_score}
          </span>
          <span className="text-xs text-slate-500 mt-0.5">匹配度</span>
        </div>

        {/* 内容区 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-gray-900 truncate">{result.job_title}</h3>
              <p className="text-sm text-slate-500">{result.company}</p>
            </div>
            <Badge 
              variant="secondary" 
              className={`flex-shrink-0 border-0 ${
                result.match_score >= 80 
                  ? 'bg-emerald-100 text-emerald-700' 
                  : result.match_score >= 60 
                    ? 'bg-amber-100 text-amber-700' 
                    : 'bg-rose-100 text-rose-700'
              }`}
            >
              {result.match_score >= 80 ? '高度匹配' : result.match_score >= 60 ? '中等匹配' : '匹配度较低'}
            </Badge>
          </div>

          <div className="space-y-3 mb-4">
            <div className="flex gap-2">
              <div className="flex-shrink-0 w-5 h-5 rounded bg-emerald-100 flex items-center justify-center mt-0.5">
                <TrendingUp className="h-3 w-3 text-emerald-600" />
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">{result.match_reason}</p>
            </div>
            {result.suggestions && (
              <div className="flex gap-2">
                <div className="flex-shrink-0 w-5 h-5 rounded bg-amber-100 flex items-center justify-center mt-0.5">
                  <Sparkles className="h-3 w-3 text-amber-600" />
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">{result.suggestions}</p>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button size="sm" className="bg-slate-900 hover:bg-slate-800" asChild>
              <Link href={`/jobs/${result.job_id}`}>查看详情</Link>
            </Button>
            <Button size="sm" variant="outline" className="border-slate-200">
              立即申请
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
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

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-900 flex items-center justify-center">
              <Briefcase className="h-5 w-5 text-white" />
            </div>
            <span className="font-bold text-lg text-slate-900">PathUp</span>
          </Link>
          <nav className="flex items-center gap-1">
            <Link href="/jobs">
              <Button variant="ghost" size="sm" className="text-slate-600">岗位查询</Button>
            </Link>
            <Link href="/resume">
              <Button variant="ghost" size="sm" className="text-slate-600">简历管理</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="flex gap-8">
          {/* 左侧控制面板 */}
          <aside className="w-80 flex-shrink-0">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 sticky top-24">
              {/* 标题 */}
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                    <Brain className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h1 className="text-lg font-bold text-slate-900">AI智能选岗</h1>
                    <p className="text-xs text-slate-500">精准匹配你的理想岗位</p>
                  </div>
                </div>
              </div>

              <div className="space-y-5">
                {/* 简历选择 */}
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">
                    选择简历
                  </label>
                  <Select value={selectedResumeId} onValueChange={setSelectedResumeId}>
                    <SelectTrigger className="h-11 bg-white border-slate-200">
                      <SelectValue placeholder="选择简历文件" />
                    </SelectTrigger>
                    <SelectContent>
                      {resumes.map((resume) => (
                        <SelectItem key={resume.id} value={resume.id.toString()}>
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-slate-400" />
                            <span>{resume.file_name}</span>
                            {resume.user_info?.name && (
                              <span className="text-slate-400">- {resume.user_info.name}</span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* 筛选条件 */}
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">
                    筛选条件
                    <span className="text-slate-400 font-normal ml-1">(可选)</span>
                  </label>
                  <div className="space-y-2">
                    <MultiSelectFilter
                      label="目标地区"
                      icon={MapPin}
                      options={regions}
                      selected={selectedRegions}
                      onChange={setSelectedRegions}
                    />
                    <MultiSelectFilter
                      label="求职方向"
                      icon={Compass}
                      options={directions}
                      selected={selectedDirections}
                      onChange={setSelectedDirections}
                    />
                  </div>
                </div>

                {/* 匹配按钮 */}
                <Button 
                  onClick={handleMatch} 
                  disabled={!selectedResumeId || matching}
                  className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white font-medium"
                >
                  {matching ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      分析中...
                    </>
                  ) : (
                    <>
                      <Zap className="mr-2 h-4 w-4" />
                      开始AI匹配
                    </>
                  )}
                </Button>

                {/* 进度条 */}
                {matching && (
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">正在分析简历...</span>
                      <span className="font-medium text-slate-700">{matchProgress}%</span>
                    </div>
                    <Progress value={matchProgress} className="h-1.5" />
                  </div>
                )}
              </div>
            </div>
          </aside>

          {/* 右侧结果区域 */}
          <div className="flex-1 min-w-0">
            {/* 结果标题 */}
            {matchResults.length > 0 && (
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-slate-400" />
                  <h2 className="text-base font-semibold text-slate-900">匹配结果</h2>
                </div>
                <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-0">
                  共 {matchResults.length} 个推荐
                </Badge>
              </div>
            )}

            {/* 结果列表 */}
            {matchResults.length > 0 && (
              <div className="space-y-4">
                {matchResults.map((result) => (
                  <ResultCard key={result.job_id} result={result} />
                ))}
              </div>
            )}

            {/* 空状态 */}
            {!matching && matchResults.length === 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center">
                <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-5">
                  <Brain className="h-8 w-8 text-slate-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">开始智能匹配</h3>
                <p className="text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">
                  选择你的简历，AI将分析你的技能和经验，为你推荐最匹配的岗位
                </p>
              </div>
            )}

            {/* 匹配中状态 */}
            {matching && (
              <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center">
                <div className="w-16 h-16 rounded-2xl bg-purple-100 flex items-center justify-center mx-auto mb-5">
                  <Loader2 className="h-8 w-8 text-purple-600 animate-spin" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">AI正在分析</h3>
                <p className="text-sm text-slate-500">
                  正在解析简历内容并匹配最佳岗位...
                </p>
              </div>
            )}
          </div>
        </div>
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
