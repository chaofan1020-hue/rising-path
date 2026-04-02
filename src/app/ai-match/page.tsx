'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
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
  Loader2, 
  ArrowRight,
  Briefcase,
  Sparkles,
  TrendingUp,
  MapPin,
  Compass,
  ChevronDown,
  FileText,
  Star,
  Zap,
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

// 筛选标签组件
function FilterTag({
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
        <button className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-sm">
          <Icon className="h-4 w-4 text-violet-400" />
          <span>{label}</span>
          {selected.length > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-violet-500 text-xs">{selected.length}</span>
          )}
          <ChevronDown className="h-4 w-4 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 bg-slate-900 border-white/10">
        <div className="grid grid-cols-2 gap-2">
          {options.map((option) => (
            <button
              key={option.id}
              onClick={() => handleToggle(option.config_value)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                selected.includes(option.config_value)
                  ? 'bg-violet-500 text-white'
                  : 'bg-white/5 hover:bg-white/10 text-slate-300'
              }`}
              translate="no"
            >
              {option.config_value}
            </button>
          ))}
        </div>
        {selected.length > 0 && (
          <button
            onClick={() => onChange([])}
            className="w-full mt-3 py-2 text-xs text-slate-400 hover:text-white transition-colors"
          >
            清除选择
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

// 结果卡片
function ResultCard({ result }: { result: MatchResult }) {
  const getScoreGradient = (score: number) => {
    if (score >= 80) return 'from-emerald-400 to-cyan-400';
    if (score >= 60) return 'from-amber-400 to-orange-400';
    return 'from-rose-400 to-pink-400';
  };

  return (
    <div className="group relative bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl p-6 hover:border-violet-500/50 transition-all duration-300">
      {/* 发光效果 */}
      <div className={`absolute inset-0 rounded-2xl bg-gradient-to-r ${getScoreGradient(result.match_score)} opacity-0 group-hover:opacity-5 transition-opacity`} />
      
      <div className="relative flex items-start gap-5">
        {/* 分数环 */}
        <div className="relative flex-shrink-0">
          <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/10" />
            <circle 
              cx="18" cy="18" r="15" fill="none" stroke="url(#gradient)" strokeWidth="2" 
              strokeDasharray={`${result.match_score} 100`}
              strokeLinecap="round"
            />
            <defs>
              <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#8b5cf6" />
                <stop offset="100%" stopColor="#06b6d4" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-lg font-bold bg-gradient-to-r ${getScoreGradient(result.match_score)} bg-clip-text text-transparent`}>
              {result.match_score}
            </span>
          </div>
        </div>

        {/* 内容 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h3 className="text-lg font-semibold text-white mb-1">{result.job_title}</h3>
              <p className="text-sm text-slate-400">{result.company}</p>
            </div>
            <Badge className="bg-violet-500/20 text-violet-300 border-0 shrink-0">
              {result.match_score >= 80 ? '强烈推荐' : result.match_score >= 60 ? '值得尝试' : '可以投递'}
            </Badge>
          </div>

          <div className="flex items-start gap-2 mb-4">
            <TrendingUp className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
            <p className="text-sm text-slate-400 leading-relaxed">{result.match_reason}</p>
          </div>

          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" className="border-white/10 bg-white/5 hover:bg-white/10 text-white" asChild>
              <Link href={`/jobs/${result.job_id}`}>查看详情</Link>
            </Button>
            <Button size="sm" className="bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-600 hover:to-cyan-600 text-white border-0">
              一键申请
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
    <div className="min-h-screen bg-slate-950 text-white">
      {/* 背景装饰 */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-violet-500/20 rounded-full blur-[128px]" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-cyan-500/20 rounded-full blur-[128px]" />
      </div>

      {/* Header */}
      <header className="relative border-b border-white/5">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center">
              <Briefcase className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-lg">PathUp</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/jobs" className="text-slate-400 hover:text-white transition-colors">岗位查询</Link>
            <Link href="/resume" className="text-slate-400 hover:text-white transition-colors">简历管理</Link>
          </nav>
        </div>
      </header>

      <main className="relative max-w-5xl mx-auto px-6 py-12">
        {/* 标题区 */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-sm mb-6">
            <Star className="h-4 w-4" />
            AI 驱动的智能匹配
          </div>
          <h1 className="text-4xl font-bold mb-4">
            <span className="bg-gradient-to-r from-white via-violet-200 to-cyan-200 bg-clip-text text-transparent">
              智能选岗
            </span>
          </h1>
          <p className="text-slate-400 text-lg max-w-xl mx-auto">
            基于 AI 深度分析你的简历，精准匹配最适合的岗位
          </p>
        </div>

        {/* 主内容区 */}
        <div className="grid lg:grid-cols-5 gap-8">
          {/* 左侧控制面板 */}
          <div className="lg:col-span-2">
            <div className="sticky top-24 space-y-6">
              {/* 简历选择 */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <label className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-violet-400" />
                  选择简历
                </label>
                <Select value={selectedResumeId} onValueChange={setSelectedResumeId}>
                  <SelectTrigger className="bg-white/5 border-white/10 hover:border-white/20 text-white">
                    <SelectValue placeholder="选择要匹配的简历" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-white/10">
                    {resumes.map((resume) => (
                      <SelectItem key={resume.id} value={resume.id.toString()} className="text-white hover:bg-white/10">
                        {resume.file_name}
                        {resume.user_info?.name && ` - ${resume.user_info.name}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 筛选条件 */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <label className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
                  <Zap className="h-4 w-4 text-violet-400" />
                  筛选条件
                  <span className="text-slate-500 font-normal">(可选)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <FilterTag
                    label="地区"
                    icon={MapPin}
                    options={regions}
                    selected={selectedRegions}
                    onChange={setSelectedRegions}
                  />
                  <FilterTag
                    label="方向"
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
                size="lg"
                className="w-full h-12 bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-600 hover:to-cyan-600 text-white font-medium rounded-xl shadow-lg shadow-violet-500/25"
              >
                {matching ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    AI 分析中...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-5 w-5" />
                    开始智能匹配
                  </>
                )}
              </Button>

              {/* 进度 */}
              {matching && (
                <div className="space-y-2">
                  <Progress value={matchProgress} className="h-1.5 bg-white/10" />
                  <p className="text-xs text-slate-500 text-center">正在分析简历内容...</p>
                </div>
              )}
            </div>
          </div>

          {/* 右侧结果区 */}
          <div className="lg:col-span-3">
            {matchResults.length > 0 ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-lg font-semibold">匹配结果</h2>
                  <span className="text-sm text-slate-400">{matchResults.length} 个推荐岗位</span>
                </div>
                {matchResults.map((result) => (
                  <ResultCard key={result.job_id} result={result} />
                ))}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="text-center py-20">
                  <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-4">
                    <Brain className="h-8 w-8 text-slate-600" />
                  </div>
                  <p className="text-slate-500">选择简历后开始匹配</p>
                </div>
              </div>
            )}
          </div>
        </div>
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
