'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Search, MapPin, Briefcase, Users, ExternalLink, ChevronDown, X, Plus, Check, Loader2 } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { AccessGuard, useAccessCode } from '@/components/access-guard';

interface Job {
  id: number;
  title: string;
  company: string;
  region: string;
  direction: string;
  audience: string;
  description: string;
  requirements: string;
  salary_range: string;
  job_url: string;
  logo_url?: string;
  is_active?: boolean;
  created_at: string;
}

interface JobConfig {
  id: number;
  config_type: string;
  config_value: string;
  sort_order: number;
  is_active: boolean;
}

// 根据公司名生成首字母占位符的颜色
function getCompanyGradient(company: string): string {
  const gradients = [
    'from-blue-500 to-cyan-500',
    'from-purple-500 to-pink-500',
    'from-emerald-500 to-teal-500',
    'from-orange-500 to-amber-500',
    'from-rose-500 to-red-500',
    'from-indigo-500 to-violet-500',
    'from-cyan-500 to-blue-500',
    'from-pink-500 to-rose-500',
  ];
  
  let hash = 0;
  for (let i = 0; i < company.length; i++) {
    hash = company.charCodeAt(i) + ((hash << 5) - hash);
  }
  return gradients[Math.abs(hash) % gradients.length];
}

// 获取公司首字母
function getCompanyInitial(company: string): string {
  // 处理中文公司名
  if (/[\u4e00-\u9fa5]/.test(company)) {
    return company.charAt(0);
  }
  // 处理英文公司名，取首字母大写
  const words = company.split(/[\s-]+/);
  if (words.length >= 2) {
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
  }
  return company.charAt(0).toUpperCase();
}

// 公司Logo组件
function CompanyLogo({ company, logoUrl }: { company: string; logoUrl?: string }) {
  const [imgError, setImgError] = useState(false);
  
  // 如果有logo_url且图片加载成功
  if (logoUrl && !imgError) {
    return (
      <div className="w-12 h-12 rounded-xl overflow-hidden bg-white border border-muted/50 flex-shrink-0 shadow-sm">
        <Image
          src={logoUrl}
          alt={company}
          width={48}
          height={48}
          className="w-full h-full object-contain p-1"
          onError={() => setImgError(true)}
        />
      </div>
    );
  }
  
  // 尝试使用 Clearbit Logo API
  const clearbitUrl = `https://logo.clearbit.com/${company.toLowerCase().replace(/\s+/g, '')}.com?size=96`;
  
  if (!imgError) {
    return (
      <div className="w-12 h-12 rounded-xl overflow-hidden bg-white border border-muted/50 flex-shrink-0 shadow-sm">
        <Image
          src={clearbitUrl}
          alt={company}
          width={48}
          height={48}
          className="w-full h-full object-contain p-1.5"
          onError={() => setImgError(true)}
          unoptimized
        />
      </div>
    );
  }
  
  // 使用首字母占位符
  return (
    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${getCompanyGradient(company)} flex items-center justify-center flex-shrink-0 shadow-sm`}>
      <span className="text-white font-bold text-lg">
        {getCompanyInitial(company)}
      </span>
    </div>
  );
}

// 多选筛选器组件 - 现代化设计
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
        <button className="inline-flex items-center gap-1.5 md:gap-2 px-2.5 py-1.5 md:px-3 md:py-2 rounded-full border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors text-xs md:text-sm">
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

// 单选筛选器组件 - 现代化设计
function SingleSelectFilter({
  label,
  icon: Icon,
  options,
  selected,
  onChange,
}: {
  label: string;
  icon: React.ElementType;
  options: JobConfig[];
  selected: string;
  onChange: (value: string) => void;
}) {
  const displayValue = selected === '全部' ? null : selected;
  
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1.5 md:gap-2 px-2.5 py-1.5 md:px-3 md:py-2 rounded-full border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors text-xs md:text-sm">
          <Icon className="h-3.5 w-3.5 md:h-4 md:w-4 text-muted-foreground" />
          <span className="font-medium">{label}</span>
          {displayValue && (
            <Badge variant="secondary" className="ml-0.5 h-4 md:h-5 px-1 md:px-1.5 rounded-full text-[10px] md:text-xs">
              {displayValue}
            </Badge>
          )}
          <ChevronDown className="h-3 w-3 md:h-3.5 md:w-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-36 md:w-40 p-1" align="start">
        <div className="space-y-0.5">
          <button
            onClick={() => onChange('全部')}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
              selected === '全部' 
                ? 'bg-primary text-primary-foreground' 
                : 'hover:bg-muted'
            }`}
          >
            全部
          </button>
          {options.map((option) => (
            <button
              key={option.id}
              onClick={() => onChange(option.config_value)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                selected === option.config_value 
                  ? 'bg-primary text-primary-foreground' 
                  : 'hover:bg-muted'
              }`}
              translate="no"
            >
              {option.config_value}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// 内部组件 - 在 AccessGuard 内部使用 useAccessCode
function JobsContent() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedDirections, setSelectedDirections] = useState<string[]>([]);
  const [selectedAudience, setSelectedAudience] = useState('全部');
  const [applyingJobId, setApplyingJobId] = useState<number | null>(null);
  const [appliedJobIds, setAppliedJobIds] = useState<Set<number>>(new Set());
  
  // 动态配置
  const [configs, setConfigs] = useState<{
    region: JobConfig[];
    direction: JobConfig[];
    audience: JobConfig[];
  }>({ region: [], direction: [], audience: [] });

  const { accessCodeId } = useAccessCode();

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedRegions.length > 0) {
        selectedRegions.forEach(r => params.append('region', r));
      }
      if (selectedDirections.length > 0) {
        selectedDirections.forEach(d => params.append('direction', d));
      }
      if (selectedAudience !== '全部') params.append('audience', selectedAudience);

      const response = await fetch(`/api/jobs?${params.toString()}`);
      const data = await response.json();
      setJobs(data.jobs || []);
    } catch (error) {
      console.error('Failed to fetch jobs:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedRegions, selectedDirections, selectedAudience]);

  // 获取已投递的岗位ID列表
  const fetchAppliedJobIds = useCallback(async () => {
    if (!accessCodeId) return;
    try {
      const response = await fetch(`/api/applications?access_code_id=${accessCodeId}`);
      const data = await response.json();
      const ids = new Set<number>((data.applications || []).map((app: { job_id: number }) => app.job_id));
      setAppliedJobIds(ids);
    } catch (error) {
      console.error('Failed to fetch applied job ids:', error);
    }
  }, [accessCodeId]);

  useEffect(() => {
    // 获取配置
    fetch('/api/configs')
      .then(res => res.json())
      .then(data => {
        setConfigs(data.configs || {});
      })
      .catch(console.error);
    
    fetchJobs();
    fetchAppliedJobIds();
  }, [fetchJobs, fetchAppliedJobIds]);

  // 添加到网申管理
  const handleAdd = async (jobId: number) => {
    if (!accessCodeId) {
      alert('请先登录');
      return;
    }
    
    if (appliedJobIds.has(jobId)) {
      return;
    }

    setApplyingJobId(jobId);
    try {
      const response = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: jobId,
          access_code_id: accessCodeId,
          status: 'pending',
          notes: '',
        }),
      });
      
      const data = await response.json();
      
      if (data.application) {
        setAppliedJobIds(new Set([...appliedJobIds, jobId]));
      } else if (data.error) {
        alert('添加失败: ' + data.error);
      }
    } catch (error) {
      console.error('Failed to add:', error);
      alert('添加失败，请重试');
    } finally {
      setApplyingJobId(null);
    }
  };

  const filteredJobs = jobs
    .filter(
      (job) =>
        job.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        job.company.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      // 首先按投递状态排序：可投递排在前面
      const aActive = a.is_active !== false;
      const bActive = b.is_active !== false;
      if (aActive !== bActive) {
        return aActive ? -1 : 1;
      }
      // 然后按创建时间排序：最新排在前面
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 md:h-6 md:w-6 text-primary" />
            <span className="font-bold text-lg md:text-xl">PathUp</span>
          </Link>
          <nav className="flex items-center gap-2 md:gap-4">
            <Link href="/resume">
              <Button variant="ghost" size="sm" className="text-xs md:text-sm">简历管理</Button>
            </Link>
            <Link href="/ai-match">
              <Button size="sm" className="text-xs md:text-sm">AI选岗</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="container mx-auto px-4 py-4 md:py-8">
        {/* Page Title */}
        <div className="mb-4 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-1 md:mb-2">岗位查询</h1>
          <p className="text-sm md:text-base text-muted-foreground">按地区、方向、受众筛选海量海外岗位</p>
        </div>

        {/* Filters */}
        <Card className="mb-4 md:mb-6 border-0 shadow-sm bg-gradient-to-r from-background to-muted/30">
          <CardContent className="pt-4 pb-4 md:pt-5 md:pb-5">
            <div className="flex flex-col gap-3 md:gap-4">
              {/* 搜索框 */}
              <div className="relative w-full md:max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="搜索岗位名称或公司..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 h-10 md:h-11 bg-background text-sm"
                />
              </div>
              
              {/* 筛选器组 */}
              <div className="flex flex-wrap items-center gap-2 md:gap-3">
                <span className="text-xs md:text-sm text-muted-foreground">筛选</span>
                <MultiSelectFilter
                  label="地区"
                  icon={MapPin}
                  options={configs.region || []}
                  selected={selectedRegions}
                  onChange={setSelectedRegions}
                />
                <MultiSelectFilter
                  label="方向"
                  icon={Briefcase}
                  options={configs.direction || []}
                  selected={selectedDirections}
                  onChange={setSelectedDirections}
                />
                <SingleSelectFilter
                  label="受众"
                  icon={Users}
                  options={configs.audience || []}
                  selected={selectedAudience}
                  onChange={setSelectedAudience}
                />
                
                {/* 清除筛选按钮 */}
                {(selectedRegions.length > 0 || selectedDirections.length > 0 || selectedAudience !== '全部') && (
                  <button
                    onClick={() => {
                      setSelectedRegions([]);
                      setSelectedDirections([]);
                      setSelectedAudience('全部');
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-3 w-3" />
                    清除全部
                  </button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <div className="space-y-3 md:space-y-4">
          {loading ? (
            <div className="text-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
              加载中...
            </div>
          ) : filteredJobs.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                暂无符合条件的岗位，请调整筛选条件
              </CardContent>
            </Card>
          ) : (
            filteredJobs.map((job) => (
              <Card key={job.id} className="hover:shadow-lg transition-all duration-300 active:scale-[0.99] md:active:scale-100 md:hover:-translate-y-0.5">
                <CardContent className="pt-3 pb-3 px-4">
                  <div className="flex gap-3">
                    {/* 左侧内容区 */}
                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                      {/* 岗位信息 - 横向布局 */}
                      <div className="flex items-start gap-2.5">
                        <CompanyLogo company={job.company} logoUrl={job.logo_url} />
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-base md:text-lg hover:text-primary cursor-pointer transition-colors line-clamp-1">
                            {job.title}
                          </h3>
                          <p className="text-sm text-muted-foreground truncate">{job.company}</p>
                        </div>
                      </div>
                      
                      {/* 标签区 */}
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="secondary" className="rounded-md text-xs" translate="no">
                          <MapPin className="h-3 w-3 mr-1" />
                          {job.region}
                        </Badge>
                        <Badge variant="secondary" className="rounded-md text-xs" translate="no">
                          <Briefcase className="h-3 w-3 mr-1" />
                          {job.direction}
                        </Badge>
                        <Badge variant="secondary" className="rounded-md text-xs" translate="no">
                          <Users className="h-3 w-3 mr-1" />
                          {job.audience}
                        </Badge>
                        {job.salary_range && (
                          <Badge variant="outline" className="text-green-600 border-green-600 rounded-md text-xs">
                            {job.salary_range}
                          </Badge>
                        )}
                        {job.is_active === false ? (
                          <Badge variant="secondary" className="bg-gray-100 text-gray-600 rounded-md text-xs">
                            不可投递
                          </Badge>
                        ) : (
                          <Badge variant="default" className="bg-green-600 rounded-md text-xs">
                            可投递
                          </Badge>
                        )}
                      </div>
                      
                      {/* 描述 */}
                      {job.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {job.description}
                        </p>
                      )}
                    </div>
                    
                    {/* 右侧按钮区 - 垂直排列 */}
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                      {job.is_active !== false && (
                        <Button 
                          size="sm" 
                          className="rounded-lg text-xs h-8 w-20 bg-green-600 hover:bg-green-700"
                          onClick={() => handleAdd(job.id)}
                          disabled={applyingJobId === job.id || appliedJobIds.has(job.id)}
                        >
                          {applyingJobId === job.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : appliedJobIds.has(job.id) ? (
                            <>
                              <Check className="h-3.5 w-3.5 mr-1" />
                              已添加
                            </>
                          ) : (
                            <>
                              <Plus className="h-3.5 w-3.5 mr-1" />
                              添加
                            </>
                          )}
                        </Button>
                      )}
                      <Button size="sm" variant="outline" asChild className="rounded-lg text-xs h-8 w-20">
                        <Link href={`/jobs/${job.id}`}>
                          详情
                        </Link>
                      </Button>
                      {job.job_url && (
                        <Button size="sm" variant="outline" asChild className="rounded-lg text-xs h-8 w-20">
                          <a href={job.job_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3.5 w-3.5 mr-1" />
                            原链接
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Results count */}
        {!loading && filteredJobs.length > 0 && (
          <div className="mt-4 md:mt-6 text-center text-xs md:text-sm text-muted-foreground">
            共找到 {filteredJobs.length} 个岗位
          </div>
        )}
      </main>
    </div>
  );
}

// 导出默认函数
export default function JobsPage() {
  return (
    <AccessGuard>
      <JobsContent />
    </AccessGuard>
  );
}
