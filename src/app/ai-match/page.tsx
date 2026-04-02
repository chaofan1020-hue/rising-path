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
  Check,
  X,
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

// 标签选择器
function TagSelector({
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
  const [open, setOpen] = useState(false);

  const handleToggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter(v => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-100 hover:bg-slate-200 transition-colors text-sm font-medium text-slate-700">
          <Icon className="h-4 w-4" />
          {label}
          {selected.length > 0 && (
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-900 text-white text-xs">
              {selected.length}
            </span>
          )}
          <ChevronDown className="h-4 w-4 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <div className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">{label}</div>
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <button
              key={option.id}
              onClick={() => handleToggle(option.config_value)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                selected.includes(option.config_value)
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
            className="mt-3 text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
          >
            <X className="h-3 w-3" /> 清除
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

// 匹配结果卡片
function MatchCard({ result, index }: { result: MatchResult; index: number }) {
  return (
    <div 
      className="group bg-white border border-slate-200 rounded-2xl p-6 hover:border-slate-300 hover:shadow-md transition-all"
      style={{ animationDelay: `${index * 100}ms` }}
    >
      <div className="flex items-start gap-4">
        {/* 排名 */}
        <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
          <span className="text-sm font-bold text-slate-400">#{index + 1}</span>
        </div>

        {/* 内容 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-4 mb-3">
            <div className="min-w-0">
              <h3 className="font-semibold text-slate-900 truncate">{result.job_title}</h3>
              <p className="text-sm text-slate-500">{result.company}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="text-right">
                <div className={`text-2xl font-bold ${
                  result.match_score >= 80 ? 'text-emerald-500' :
                  result.match_score >= 60 ? 'text-amber-500' : 'text-rose-500'
                }`}>
                  {result.match_score}%
                </div>
                <div className="text-xs text-slate-400">匹配度</div>
              </div>
            </div>
          </div>

          {/* 标签式信息 */}
          <div className="flex flex-wrap gap-2 mb-4">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-md text-xs font-medium">
              <TrendingUp className="h-3 w-3" />
              {result.match_score >= 80 ? '强烈推荐' : result.match_score >= 60 ? '值得尝试' : '可以投递'}
            </span>
          </div>

          {/* 匹配原因 */}
          <p className="text-sm text-slate-600 mb-4 line-clamp-2">{result.match_reason}</p>

          {/* 操作 */}
          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" className="rounded-full border-slate-200" asChild>
              <Link href={`/jobs/${result.job_id}`}>查看详情</Link>
            </Button>
            <Button size="sm" className="rounded-full bg-slate-900 hover:bg-slate-800">
              一键申请
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
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

  const selectedResume = resumes.find(r => r.id.toString() === selectedResumeId);

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-slate-100">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center">
              <Briefcase className="h-4 w-4 text-white" />
            </div>
            <span className="font-semibold text-slate-900">PathUp</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/jobs" className="text-slate-500 hover:text-slate-900 transition-colors">岗位查询</Link>
            <Link href="/resume" className="text-slate-500 hover:text-slate-900 transition-colors">简历管理</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        {/* 标题 */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-100 mb-4">
            <Brain className="h-7 w-7 text-slate-700" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">AI智能选岗</h1>
          <p className="text-slate-500">上传简历，让AI帮你找到最匹配的岗位</p>
        </div>

        {/* 选择区域 */}
        <div className="bg-slate-50 rounded-3xl p-8 mb-8">
          {/* 简历选择 */}
          <div className="mb-6">
            <label className="text-sm font-medium text-slate-700 mb-3 block">
              选择简历
            </label>
            {selectedResumeId ? (
              <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <FileText className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div>
                    <div className="font-medium text-slate-900">{selectedResume?.file_name}</div>
                    {selectedResume?.user_info?.name && (
                      <div className="text-sm text-slate-500">{selectedResume.user_info.name}</div>
                    )}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedResumeId('')}>
                  更换
                </Button>
              </div>
            ) : (
              <Select value={selectedResumeId} onValueChange={setSelectedResumeId}>
                <SelectTrigger className="h-12 bg-white border-slate-200 rounded-xl">
                  <SelectValue placeholder="点击选择简历文件" />
                </SelectTrigger>
                <SelectContent>
                  {resumes.map((resume) => (
                    <SelectItem key={resume.id} value={resume.id.toString()}>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-slate-400" />
                        {resume.file_name}
                        {resume.user_info?.name && ` - ${resume.user_info.name}`}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* 筛选条件 */}
          <div className="mb-6">
            <label className="text-sm font-medium text-slate-700 mb-3 block">
              筛选条件 <span className="text-slate-400 font-normal">(可选)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <TagSelector
                label="地区"
                icon={MapPin}
                options={regions}
                selected={selectedRegions}
                onChange={setSelectedRegions}
              />
              <TagSelector
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
            className="w-full h-12 bg-slate-900 hover:bg-slate-800 rounded-xl font-medium"
          >
            {matching ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                AI分析中...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-5 w-5" />
                开始匹配
              </>
            )}
          </Button>

          {/* 进度 */}
          {matching && (
            <div className="mt-4">
              <Progress value={matchProgress} className="h-1" />
              <p className="text-xs text-slate-500 text-center mt-2">正在分析简历并匹配最佳岗位...</p>
            </div>
          )}
        </div>

        {/* 结果 */}
        {matchResults.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-slate-900">匹配结果</h2>
              <span className="text-sm text-slate-500">{matchResults.length} 个推荐</span>
            </div>
            <div className="space-y-3">
              {matchResults.map((result, index) => (
                <MatchCard key={result.job_id} result={result} index={index} />
              ))}
            </div>
          </div>
        )}

        {/* 空状态 */}
        {!matching && matchResults.length === 0 && (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 mb-4">
              <Brain className="h-6 w-6 text-slate-400" />
            </div>
            <p className="text-slate-500">选择简历后点击匹配按钮开始</p>
          </div>
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
