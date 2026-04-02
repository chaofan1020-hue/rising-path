'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, MapPin, Briefcase, Users, ExternalLink, Building } from 'lucide-react';
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

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('全部');
  const [selectedDirection, setSelectedDirection] = useState('全部');
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
  }, [selectedRegion, selectedDirection, selectedAudience]);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedRegion !== '全部') params.append('region', selectedRegion);
      if (selectedDirection !== '全部') params.append('direction', selectedDirection);
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

  const filteredJobs = jobs.filter(
    (job) =>
      job.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.company.toLowerCase().includes(searchTerm.toLowerCase())
  );

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

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="搜索岗位名称或公司..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <Select value={selectedRegion} onValueChange={setSelectedRegion}>
                <SelectTrigger className="w-full md:w-40">
                  <SelectValue placeholder="地区" />
                </SelectTrigger>
                <SelectContent translate="no">
                  <SelectItem value="全部">全部</SelectItem>
                  {configs.region?.map((config) => (
                    <SelectItem key={config.id} value={config.config_value}>
                      {config.config_value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedDirection} onValueChange={setSelectedDirection}>
                <SelectTrigger className="w-full md:w-40">
                  <SelectValue placeholder="方向" />
                </SelectTrigger>
                <SelectContent translate="no">
                  <SelectItem value="全部">全部</SelectItem>
                  {configs.direction?.map((config) => (
                    <SelectItem key={config.id} value={config.config_value}>
                      {config.config_value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedAudience} onValueChange={setSelectedAudience}>
                <SelectTrigger className="w-full md:w-40">
                  <SelectValue placeholder="受众" />
                </SelectTrigger>
                <SelectContent translate="no">
                  <SelectItem value="全部">全部</SelectItem>
                  {configs.audience?.map((config) => (
                    <SelectItem key={config.id} value={config.config_value}>
                      {config.config_value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <div className="space-y-4">
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
                <CardContent className="pt-6">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-start gap-4">
                        <CompanyLogo company={job.company} logoUrl={job.logo_url} />
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-lg hover:text-primary cursor-pointer transition-colors">
                            {job.title}
                          </h3>
                          <p className="text-muted-foreground">{job.company}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-4">
                        <Badge variant="secondary" className="rounded-md" translate="no">
                          <MapPin className="h-3 w-3 mr-1" />
                          {job.region}
                        </Badge>
                        <Badge variant="secondary" className="rounded-md" translate="no">
                          <Briefcase className="h-3 w-3 mr-1" />
                          {job.direction}
                        </Badge>
                        <Badge variant="secondary" className="rounded-md" translate="no">
                          <Users className="h-3 w-3 mr-1" />
                          {job.audience}
                        </Badge>
                        {job.salary_range && (
                          <Badge variant="outline" className="text-green-600 border-green-600 rounded-md">
                            {job.salary_range}
                          </Badge>
                        )}
                      </div>
                      {job.description && (
                        <p className="text-sm text-muted-foreground mt-3 line-clamp-2">
                          {job.description}
                        </p>
                      )}
                    </div>
                    <div className="flex md:flex-col gap-2">
                      <Button size="sm" asChild className="rounded-lg">
                        <Link href={`/jobs/${job.id}`}>
                          查看详情
                        </Link>
                      </Button>
                      {job.job_url && (
                        <Button size="sm" variant="outline" asChild className="rounded-lg">
                          <a href={job.job_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4 mr-1" />
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
          <div className="mt-6 text-center text-sm text-muted-foreground">
            共找到 {filteredJobs.length} 个岗位
          </div>
        )}
      </main>
    </div>
  );
}
