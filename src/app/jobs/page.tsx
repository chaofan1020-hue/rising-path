'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Search, MapPin, Briefcase, Users, ExternalLink, Building, ChevronDown, X } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

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

// 高级筛选器组件
function PremiumFilterChip({
  label,
  icon: Icon,
  options,
  selected,
  onChange,
  multi = false,
}: {
  label: string;
  icon: React.ElementType;
  options: JobConfig[];
  selected: string | string[];
  onChange: (value: string | string[]) => void;
  multi?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  
  const selectedArray = Array.isArray(selected) ? selected : selected === '全部' ? [] : [selected];
  const hasSelection = selectedArray.length > 0;

  const handleToggle = (value: string) => {
    if (multi) {
      const current = selected as string[];
      if (current.includes(value)) {
        onChange(current.filter(v => v !== value));
      } else {
        onChange([...current, value]);
      }
    } else {
      onChange(value);
      setIsOpen(false);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button 
          className={`
            group relative inline-flex items-center gap-2 px-4 py-2.5 
            rounded-xl text-sm font-medium
            transition-all duration-300 ease-out
            ${hasSelection 
              ? 'bg-gradient-to-r from-primary/90 to-primary text-primary-foreground shadow-lg shadow-primary/25' 
              : 'bg-white/80 backdrop-blur-sm border border-gray-200/60 hover:border-primary/30 hover:bg-white hover:shadow-md'
            }
          `}
        >
          <Icon className={`h-4 w-4 transition-colors ${hasSelection ? 'text-primary-foreground' : 'text-gray-400 group-hover:text-primary'}`} />
          <span>{label}</span>
          {hasSelection && (
            <span className="flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-white/20 text-xs font-semibold">
              {selectedArray.length}
            </span>
          )}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''} ${hasSelection ? 'text-primary-foreground/70' : 'text-gray-400'}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-52 p-1.5 bg-white/95 backdrop-blur-xl border border-gray-200/50 shadow-2xl rounded-xl" 
        align="start"
        sideOffset={8}
      >
        {multi ? (
          <>
            <div className="max-h-56 overflow-y-auto py-1 px-0.5 space-y-0.5">
              {options.map((option) => {
                const isSelected = selectedArray.includes(option.config_value);
                return (
                  <button
                    key={option.id}
                    onClick={() => handleToggle(option.config_value)}
                    className={`
                      w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm
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
                    <span className="font-medium">{option.config_value}</span>
                  </button>
                );
              })}
            </div>
            {hasSelection && (
              <div className="border-t border-gray-100 mt-1 pt-1.5 px-1">
                <button
                  onClick={() => onChange([])}
                  className="w-full text-center text-xs text-gray-500 hover:text-primary py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  清除选择
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="py-1 px-0.5 space-y-0.5">
            <button
              onClick={() => handleToggle('全部')}
              className={`
                w-full text-left px-3 py-2 rounded-lg text-sm font-medium
                transition-all duration-200
                {(selected as string) === '全部' 
                  ? 'bg-primary text-primary-foreground' 
                  : 'hover:bg-gray-100 text-gray-700'
                }
              `}
            >
              全部
            </button>
            {options.map((option) => {
              const isSelected = (selected as string) === option.config_value;
              return (
                <button
                  key={option.id}
                  onClick={() => handleToggle(option.config_value)}
                  className={`
                    w-full text-left px-3 py-2 rounded-lg text-sm font-medium
                    transition-all duration-200
                    ${isSelected 
                      ? 'bg-primary text-primary-foreground' 
                      : 'hover:bg-gray-100 text-gray-700'
                    }
                  `}
                  translate="no"
                >
                  {option.config_value}
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedDirections, setSelectedDirections] = useState<string[]>([]);
  const [selectedAudience, setSelectedAudience] = useState('全部');
  
  // 动态配置
  const [configs, setConfigs] = useState<{
    region: JobConfig[];
    direction: JobConfig[];
    audience: JobConfig[];
  }>({ region: [], direction: [], audience: [] });

  useEffect(() => {
    // 获取配置
    fetch('/api/configs')
      .then(res => res.json())
      .then(data => {
        setConfigs(data.configs || {});
      })
      .catch(console.error);
    
    fetchJobs();
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [selectedRegions, selectedDirections, selectedAudience]);

  const fetchJobs = async () => {
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
            <Briefcase className="h-6 w-6 text-primary" />
            <span className="font-bold text-xl">PathUp</span>
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/resume">
              <Button variant="ghost" size="sm">简历管理</Button>
            </Link>
            <Link href="/ai-match">
              <Button size="sm">AI选岗</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Page Title */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">岗位查询</h1>
          <p className="text-muted-foreground">按地区、方向、受众筛选海量海外岗位</p>
        </div>

        {/* Premium Filters */}
        <div className="mb-8">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-white via-gray-50/50 to-white border border-gray-200/60 shadow-xl shadow-gray-200/50">
            {/* 装饰背景 */}
            <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-primary/5 pointer-events-none" />
            
            <div className="relative p-6">
              {/* 搜索行 */}
              <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
                {/* 搜索框 */}
                <div className="relative flex-1 max-w-lg">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                    <Search className="h-5 w-5" />
                  </div>
                  <input
                    type="text"
                    placeholder="搜索岗位名称或公司..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full h-12 pl-12 pr-4 rounded-xl border border-gray-200/80 bg-white/80 backdrop-blur-sm text-base placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all"
                  />
                </div>
                
                {/* 筛选器组 */}
                <div className="flex flex-wrap items-center gap-3">
                  <PremiumFilterChip
                    label="地区"
                    icon={MapPin}
                    options={configs.region || []}
                    selected={selectedRegions}
                    onChange={(v) => setSelectedRegions(v as string[])}
                    multi
                  />
                  <PremiumFilterChip
                    label="方向"
                    icon={Briefcase}
                    options={configs.direction || []}
                    selected={selectedDirections}
                    onChange={(v) => setSelectedDirections(v as string[])}
                    multi
                  />
                  <PremiumFilterChip
                    label="受众"
                    icon={Users}
                    options={configs.audience || []}
                    selected={selectedAudience}
                    onChange={(v) => setSelectedAudience(v as string)}
                    multi={false}
                  />
                  
                  {/* 清除按钮 */}
                  {(selectedRegions.length > 0 || selectedDirections.length > 0 || selectedAudience !== '全部') && (
                    <button
                      onClick={() => {
                        setSelectedRegions([]);
                        setSelectedDirections([]);
                        setSelectedAudience('全部');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-primary transition-colors group"
                    >
                      <X className="h-4 w-4 transition-transform group-hover:rotate-90" />
                      <span>重置</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="max-w-2xl mx-auto space-y-3">
          {loading ? (
            <div className="text-center py-12 text-muted-foreground">加载中...</div>
          ) : filteredJobs.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                暂无符合条件的岗位，请调整筛选条件
              </CardContent>
            </Card>
          ) : (
            filteredJobs.map((job) => (
              <Card key={job.id} className="hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5">
                <CardContent className="py-4 px-5">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <CompanyLogo company={job.company} logoUrl={job.logo_url} />
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-sm hover:text-primary cursor-pointer transition-colors line-clamp-1">
                            {job.title}
                          </h3>
                          <p className="text-xs text-muted-foreground">{job.company}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2 ml-12">
                        <Badge variant="secondary" className="rounded text-xs px-2 py-0.5" translate="no">
                          {job.region}
                        </Badge>
                        <Badge variant="secondary" className="rounded text-xs px-2 py-0.5" translate="no">
                          {job.direction}
                        </Badge>
                        <Badge variant="secondary" className="rounded text-xs px-2 py-0.5" translate="no">
                          {job.audience}
                        </Badge>
                        {job.salary_range && (
                          <Badge variant="outline" className="text-green-600 border-green-600 rounded text-xs px-2 py-0.5">
                            {job.salary_range}
                          </Badge>
                        )}
                        {job.is_active === false ? (
                          <Badge variant="secondary" className="bg-gray-100 text-gray-500 rounded text-xs px-2 py-0.5">
                            不可投递
                          </Badge>
                        ) : (
                          <Badge variant="default" className="bg-green-600 rounded text-xs px-2 py-0.5">
                            可投递
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0 ml-12 md:ml-0">
                      <Button size="sm" asChild className="rounded h-7 text-xs px-3">
                        <Link href={`/jobs/${job.id}`}>
                          查看详情
                        </Link>
                      </Button>
                      {job.job_url && (
                        <Button size="sm" variant="outline" asChild className="rounded h-7 text-xs px-3">
                          <a href={job.job_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3 w-3 mr-1" />
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
          
          {/* Results count */}
          {!loading && filteredJobs.length > 0 && (
            <div className="pt-2 text-center text-sm text-muted-foreground">
              共找到 {filteredJobs.length} 个岗位
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
