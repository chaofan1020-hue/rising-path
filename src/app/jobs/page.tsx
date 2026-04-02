'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, MapPin, Briefcase, Users, ExternalLink, Bookmark, Building } from 'lucide-react';
import Link from 'next/link';

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
  created_at: string;
}

const regions = ['全部', '北美', '欧洲', '亚太', '澳洲', '中东'];
const directions = ['全部', '技术', '产品', '设计', '运营', '市场', '金融', '咨询'];
const audiences = ['全部', '应届生', '社招', '实习', '校招'];

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('全部');
  const [selectedDirection, setSelectedDirection] = useState('全部');
  const [selectedAudience, setSelectedAudience] = useState('全部');

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
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Briefcase className="h-6 w-6 text-primary" />
            <span className="font-bold text-xl">CareerPath</span>
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
                <SelectContent>
                  {regions.map((region) => (
                    <SelectItem key={region} value={region}>
                      {region}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedDirection} onValueChange={setSelectedDirection}>
                <SelectTrigger className="w-full md:w-40">
                  <SelectValue placeholder="方向" />
                </SelectTrigger>
                <SelectContent>
                  {directions.map((direction) => (
                    <SelectItem key={direction} value={direction}>
                      {direction}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedAudience} onValueChange={setSelectedAudience}>
                <SelectTrigger className="w-full md:w-40">
                  <SelectValue placeholder="受众" />
                </SelectTrigger>
                <SelectContent>
                  {audiences.map((audience) => (
                    <SelectItem key={audience} value={audience}>
                      {audience}
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
              <Card key={job.id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-6">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-start gap-3">
                        <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Building className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-lg hover:text-primary cursor-pointer">
                            {job.title}
                          </h3>
                          <p className="text-muted-foreground">{job.company}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-4">
                        <Badge variant="secondary">
                          <MapPin className="h-3 w-3 mr-1" />
                          {job.region}
                        </Badge>
                        <Badge variant="secondary">
                          <Briefcase className="h-3 w-3 mr-1" />
                          {job.direction}
                        </Badge>
                        <Badge variant="secondary">
                          <Users className="h-3 w-3 mr-1" />
                          {job.audience}
                        </Badge>
                        {job.salary_range && (
                          <Badge variant="outline" className="text-green-600 border-green-600">
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
                      <Button size="sm" asChild>
                        <Link href={`/jobs/${job.id}`}>
                          查看详情
                        </Link>
                      </Button>
                      {job.job_url && (
                        <Button size="sm" variant="outline" asChild>
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
