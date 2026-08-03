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
import { AccessGuard, useAccessCode } from '@/components/access-guard';
import { Header1 } from '@/components/header1';
import { useLanguage } from '@/lib/language-context';

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
  sponsorship?: 'yes' | 'no' | 'unknown';
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
      <div className="w-12 h-12 rounded-xl overflow-hidden bg-white border border-zinc-200 dark:border-zinc-700 flex-shrink-0">
        <img
          src={logoUrl}
          alt={company}
          className="w-full h-full object-contain p-1"
          onError={() => {
            console.log('Logo load error:', logoUrl);
            setImgError(true);
          }}
        />
      </div>
    );
  }

  // 尝试使用 Clearbit Logo API
  const clearbitUrl = `https://logo.clearbit.com/${company.toLowerCase().replace(/\s+/g, '')}.com?size=96`;

  if (!imgError) {
    return (
      <div className="w-12 h-12 rounded-xl overflow-hidden bg-white border border-zinc-200 dark:border-zinc-700 flex-shrink-0">
        <img
          src={clearbitUrl}
          alt={company}
          className="w-full h-full object-contain p-1.5"
          onError={() => setImgError(true)}
        />
      </div>
    );
  }

  // 使用首字母占位符（黑色圆角方块语言）
  return (
    <div className="w-12 h-12 rounded-xl bg-zinc-900 dark:bg-white flex items-center justify-center flex-shrink-0 shadow-lg shadow-zinc-900/15 dark:shadow-black/30">
      <span className="text-white dark:text-zinc-900 font-bold text-lg">
        {getCompanyInitial(company)}
      </span>
    </div>
  );
}

// 大地区选项（用于筛选）
const mainRegions = [
  { id: -1, config_type: 'region', config_value: '美国', sort_order: 1, is_active: true },
  { id: -2, config_type: 'region', config_value: '英国', sort_order: 2, is_active: true },
  { id: -3, config_type: 'region', config_value: '加拿大', sort_order: 3, is_active: true },
  { id: -4, config_type: 'region', config_value: '澳大利亚', sort_order: 4, is_active: true },
  { id: -5, config_type: 'region', config_value: '新加坡', sort_order: 5, is_active: true },
  { id: -6, config_type: 'region', config_value: '香港', sort_order: 6, is_active: true },
  { id: -7, config_type: 'region', config_value: '日本', sort_order: 7, is_active: true },
  { id: -8, config_type: 'region', config_value: '欧洲', sort_order: 8, is_active: true },
];

// 地区映射：将具体地区映射到所属大地区
const regionMapping: Record<string, string> = {
  // 美国主要城市
  'San Francisco, CA': '美国',
  'Seattle, WA': '美国',
  'New York, NY': '美国',
  'Los Angeles, CA': '美国',
  'Austin, TX': '美国',
  'Boston, MA': '美国',
  'Chicago, IL': '美国',
  'Denver, CO': '美国',
  'Atlanta, GA': '美国',
  'Remote - United States': '美国',
  'United States': '美国',
  // 英国
  'London, UK': '英国',
  'United Kingdom': '英国',
  // 加拿大
  'Toronto, ON': '加拿大',
  'Vancouver, BC': '加拿大',
  'Canada': '加拿大',
  // 澳大利亚
  'Sydney, NSW': '澳大利亚',
  'Melbourne, VIC': '澳大利亚',
  'Australia': '澳大利亚',
  // 新加坡
  'Singapore': '新加坡',
  // 香港
  'Hong Kong': '香港',
  // 日本
  'Tokyo, Japan': '日本',
  'Japan': '日本',
  // 欧洲
  'Germany': '德国',
  'France': '法国',
  'Europe': '欧洲',
};

// 获取地区对应的显示文本
function getRegionDisplayText(region: string): string {
  return region;
}

// 获取岗位所属的大地区
function getRegionCategory(region: string): string {
  return regionMapping[region] || region;
}

// 判断岗位是否匹配选中的地区（支持包含关系）
function isRegionMatch(jobRegion: string, selectedRegions: string[]): boolean {
  if (selectedRegions.length === 0) return true;
  
  for (const selected of selectedRegions) {
    const jobCategory = getRegionCategory(jobRegion);
    // 如果选中的地区等于岗位的地区分类
    if (jobCategory === selected) return true;
    // 如果选中的地区等于岗位的完整地区
    if (jobRegion === selected) return true;
  }
  return false;
}

// 多选筛选器组件 - 现代化设计
function MultiSelectFilter({
  label,
  icon: Icon,
  options,
  selected,
  onChange,
  showFlag = false,
  t,
}: {
  label: string;
  icon: React.ElementType;
  options: JobConfig[];
  selected: string[];
  onChange: (values: string[]) => void;
  showFlag?: boolean;
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
        <button className="inline-flex items-center gap-1.5 md:gap-2 px-2.5 py-1.5 md:px-3 md:py-2 rounded-full text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 transition-colors text-xs md:text-sm">
          <Icon className="h-3.5 w-3.5 md:h-4 md:w-4 text-zinc-400 dark:text-zinc-500" />
          <span className="font-medium">{label}</span>
          {selected.length > 0 && (
            <Badge variant="secondary" className="ml-0.5 h-4 md:h-5 px-1 md:px-1.5 rounded-full text-[10px] md:text-xs bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:bg-zinc-900">
              {selected.length}
            </Badge>
          )}
          <ChevronDown className="h-3 w-3 md:h-3.5 md:w-3.5 text-zinc-400 dark:text-zinc-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-44 md:w-48 p-2" align="start">
        <div className="max-h-60 overflow-y-auto space-y-1">
          {options.map((option) => (
            <label
              key={option.id}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
                selected.includes(option.config_value)
                  ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60'
              }`}
              translate="no"
            >
              <Checkbox
                checked={selected.includes(option.config_value)}
                onCheckedChange={() => handleToggle(option.config_value)}
                className="data-[state=checked]:bg-zinc-900 data-[state=checked]:border-zinc-900 dark:data-[state=checked]:bg-white dark:data-[state=checked]:border-white dark:data-[state=checked]:text-zinc-900"
              />
              <span className="text-sm font-medium">
                {showFlag ? getRegionDisplayText(option.config_value) : option.config_value}
              </span>
            </label>
          ))}
        </div>
        {options.length === 0 && (
          <div className="text-center py-2 text-sm text-zinc-400">{t('jobs.noOptions')}</div>
        )}
        {selected.length > 0 && (
          <div className="border-t border-zinc-100 dark:border-zinc-800 mt-2 pt-2">
            <button
              onClick={() => onChange([])}
              className="w-full text-xs text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors py-1"
            >
              {t('jobs.clearAll')}
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
  t,
}: {
  label: string;
  icon: React.ElementType;
  options: JobConfig[];
  selected: string;
  onChange: (value: string) => void;
  t: (key: string) => string;
}) {
  const displayValue = selected === '全部' || selected === 'All' ? null : selected;
  
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1.5 md:gap-2 px-2.5 py-1.5 md:px-3 md:py-2 rounded-full text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 transition-colors text-xs md:text-sm">
          <Icon className="h-3.5 w-3.5 md:h-4 md:w-4 text-zinc-400 dark:text-zinc-500" />
          <span className="font-medium">{label}</span>
          {displayValue && (
            <Badge variant="secondary" className="ml-0.5 h-4 md:h-5 px-1 md:px-1.5 rounded-full text-[10px] md:text-xs bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:bg-zinc-900">
              {displayValue}
            </Badge>
          )}
          <ChevronDown className="h-3 w-3 md:h-3.5 md:w-3.5 text-zinc-400 dark:text-zinc-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-36 md:w-40 p-1" align="start">
        <div className="space-y-0.5">
          <button
            onClick={() => onChange(t('page.all'))}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
              selected === t('page.all')
                ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            {t('page.all')}
          </button>
          {options.map((option) => (
            <button
              key={option.id}
              onClick={() => onChange(option.config_value)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                selected === option.config_value
                  ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                  : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
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
  const [selectedAudience, setSelectedAudience] = useState('');
  const [applyingJobId, setApplyingJobId] = useState<number | null>(null);
  const [appliedJobIds, setAppliedJobIds] = useState<Set<number>>(new Set());
  
  // 动态配置
  const [configs, setConfigs] = useState<{
    region: JobConfig[];
    direction: JobConfig[];
    audience: JobConfig[];
  }>({ region: [], direction: [], audience: [] });

  const { accessCodeId } = useAccessCode();
  const { t } = useLanguage();

  // 初始化受众为"全部"
  useEffect(() => {
    if (!selectedAudience) {
      setSelectedAudience(t('page.all'));
    }
  }, [t, selectedAudience]);

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
      if (selectedAudience !== t('page.all')) params.append('audience', selectedAudience);

      const response = await fetch(`/api/jobs?${params.toString()}`);
      const data = await response.json();
      setJobs(data.jobs || []);
    } catch (error) {
      console.error('Failed to fetch jobs:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedRegions, selectedDirections, selectedAudience, t]);

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
        // 合并大地区选项和具体地区选项
        const regionConfigs = data.configs?.region || [];
        // 去重：大地区选项优先
        const existingMainRegions = regionConfigs.filter(
          (r: JobConfig) => mainRegions.some(mr => mr.config_value === r.config_value)
        );
        if (existingMainRegions.length === 0) {
          setConfigs({
            ...data.configs,
            region: [...mainRegions, ...regionConfigs]
          });
        } else {
          setConfigs(data.configs || {});
        }
      })
      .catch(console.error);
    
    fetchJobs();
    fetchAppliedJobIds();
  }, [fetchJobs, fetchAppliedJobIds]);

  // 添加到网申管理
  const handleAdd = async (jobId: number) => {
    if (!accessCodeId) {
      alert(t('jobs.loginFirst'));
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
        alert(t('jobs.addFailed') + ': ' + data.error);
      }
    } catch (error) {
      console.error('Failed to add:', error);
      alert(t('jobs.addFailedRetry'));
    } finally {
      setApplyingJobId(null);
    }
  };

  const filteredJobs = jobs
    .filter(
      (job) =>
        (job.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        job.company.toLowerCase().includes(searchTerm.toLowerCase())) &&
        // 地区筛选（支持包含关系）
        (selectedRegions.length === 0 || isRegionMatch(job.region, selectedRegions)) &&
        // 方向筛选
        (selectedDirections.length === 0 || selectedDirections.includes(job.direction)) &&
        // 受众筛选
        (selectedAudience === t('page.all') || job.audience === selectedAudience)
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
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <Header1 />
      <main className="relative container mx-auto px-4 pt-24 md:pt-28 pb-16">
        {/* 超大半透明水印背景（极简黑白灰语言） */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-14 md:top-20 overflow-hidden select-none">
          <span className="block text-center text-[24vw] md:text-[17vw] leading-[0.85] font-bold tracking-tighter text-zinc-900/[0.045] dark:text-white/[0.05]">
            JOBS
          </span>
        </div>

        {/* Hero：居中标题（悬浮于水印之上） */}
        <div className="relative mb-10 md:mb-14 text-center">
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-zinc-900 dark:text-white mb-3">{t('page.jobs.title')}</h1>
          <p className="text-sm md:text-base text-zinc-500 dark:text-zinc-400 max-w-xl mx-auto">{t('page.jobs.subtitle')}</p>
        </div>

        {/* Filters */}
        <Card className="relative mb-4 md:mb-6 rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none bg-white dark:bg-zinc-950">
          <CardContent className="pt-4 pb-4 md:pt-5 md:pb-5">
            <div className="flex flex-col gap-3 md:gap-4">
              {/* 搜索框 */}
              <div className="relative w-full md:max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
                <Input
                  placeholder={t('jobs.searchPlaceholder')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 h-10 md:h-11 border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus-visible:ring-zinc-300 dark:focus-visible:ring-zinc-600"
                />
              </div>
              
              {/* 筛选器组 */}
              <div className="flex flex-wrap items-center gap-2 md:gap-3">
                <span className="text-xs md:text-sm text-zinc-400 dark:text-zinc-500">{t('jobs.filter')}</span>
                <MultiSelectFilter
                  label={t('jobs.region')}
                  icon={MapPin}
                  options={configs.region || []}
                  selected={selectedRegions}
                  onChange={setSelectedRegions}
                  showFlag={true}
                  t={t}
                />
                <MultiSelectFilter
                  label={t('jobs.direction')}
                  icon={Briefcase}
                  options={configs.direction || []}
                  selected={selectedDirections}
                  onChange={setSelectedDirections}
                  t={t}
                />
                <SingleSelectFilter
                  label={t('jobs.audience')}
                  icon={Users}
                  options={configs.audience || []}
                  selected={selectedAudience}
                  onChange={setSelectedAudience}
                  t={t}
                />
                
                {/* 清除筛选按钮 */}
                {(selectedRegions.length > 0 || selectedDirections.length > 0 || selectedAudience !== t('page.all')) && (
                  <button
                    onClick={() => {
                      setSelectedRegions([]);
                      setSelectedDirections([]);
                      setSelectedAudience(t('page.all'));
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                  >
                    <X className="h-3 w-3" />
                    {t('jobs.clearAll')}
                  </button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <div className="relative space-y-3 md:space-y-4">
          {loading ? (
            <div className="text-center py-12 text-zinc-400">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
              {t('jobs.loading')}
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 py-14 text-center text-zinc-400">
              <Briefcase className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">{t('jobs.noJobs')}</p>
            </div>
          ) : (
            filteredJobs.map((job) => (
              <Card key={job.id} className="rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none hover:shadow-xl hover:shadow-zinc-900/[0.06] dark:hover:shadow-black/30 transition-shadow duration-300 bg-white dark:bg-zinc-950">
                <CardContent className="pt-3 md:pt-4 pb-3">
                  <div className="flex gap-3 md:gap-4">
                    {/* 左侧内容区 */}
                    <div className="flex-1 min-w-0 flex flex-col gap-2 md:gap-3">
                      {/* 岗位信息 - 横向布局 */}
                      <div className="flex items-start gap-3 md:gap-4">
                        <CompanyLogo company={job.company} logoUrl={job.logo_url} />
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold tracking-tight text-base md:text-lg text-zinc-900 dark:text-zinc-50 line-clamp-1">
                            {job.title}
                          </h3>
                          <p className="text-sm text-zinc-500 dark:text-zinc-400 truncate">{job.company}</p>
                        </div>
                      </div>

                      {/* 标签区 */}
                      <div className="flex flex-wrap gap-1.5 md:gap-2">
                        <Badge variant="secondary" className="rounded-md text-xs bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 hover:bg-zinc-100" translate="no">
                          <MapPin className="h-3 w-3 mr-1" />
                          {getRegionDisplayText(job.region)}
                        </Badge>
                        <Badge variant="secondary" className="rounded-md text-xs bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 hover:bg-zinc-100" translate="no">
                          <Briefcase className="h-3 w-3 mr-1" />
                          {job.direction}
                        </Badge>
                        <Badge variant="secondary" className="rounded-md text-xs bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 hover:bg-zinc-100" translate="no">
                          <Users className="h-3 w-3 mr-1" />
                          {job.audience}
                        </Badge>
                        {job.salary_range && (
                          <Badge variant="outline" className="border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-md text-xs">
                            {job.salary_range}
                          </Badge>
                        )}
                        {job.sponsorship && job.sponsorship !== 'unknown' && (
                          <Badge
                            variant="outline"
                            className="rounded-md text-xs border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300"
                          >
                            {job.sponsorship === 'yes' ? t('jobs.sponsor') : t('jobs.noSponsor')}
                          </Badge>
                        )}
                        {job.is_active === false ? (
                          <Badge variant="secondary" className="bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500 rounded-md text-xs hover:bg-zinc-100">
                            {t('jobs.inactive')}
                          </Badge>
                        ) : (
                          <Badge variant="default" className="bg-zinc-900 dark:bg-white dark:text-zinc-900 rounded-md text-xs hover:bg-zinc-900">
                            {t('jobs.active')}
                          </Badge>
                        )}
                      </div>

                      {/* 描述 */}
                      {job.description && (
                        <p className="text-xs md:text-sm text-zinc-400 dark:text-zinc-500 line-clamp-2">
                          {job.description}
                        </p>
                      )}
                    </div>

                    {/* 右侧按钮区 - 垂直排列 */}
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      {job.is_active !== false && (
                        <Button
                          size="sm"
                          className="rounded-lg text-xs md:text-sm h-9 w-24 md:w-28 bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                          onClick={() => handleAdd(job.id)}
                          disabled={applyingJobId === job.id || appliedJobIds.has(job.id)}
                        >
                          {applyingJobId === job.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : appliedJobIds.has(job.id) ? (
                            <>
                              <Check className="h-3.5 w-3.5 mr-1" />
                              {t('jobs.added')}
                            </>
                          ) : (
                            <>
                              <Plus className="h-3.5 w-3.5 mr-1" />
                              {t('jobs.add')}
                            </>
                          )}
                        </Button>
                      )}
                      <Button size="sm" variant="outline" asChild className="rounded-lg text-xs md:text-sm h-9 whitespace-nowrap border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                        <Link href={`/jobs/${job.id}`}>
                          {t('jobs.viewDetail')}
                        </Link>
                      </Button>
                      {job.job_url && (
                        <Button size="sm" variant="outline" asChild className="rounded-lg text-xs md:text-sm h-9 whitespace-nowrap border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                          <a href={job.job_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3.5 w-3.5 mr-1 flex-shrink-0" />
                            {t('jobs.originalLink')}
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
          <div className="relative mt-4 md:mt-6 text-center text-xs md:text-sm text-zinc-400 dark:text-zinc-500">
            {t('jobs.foundJobs')} {filteredJobs.length} {t('jobs.jobsUnit')}
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
