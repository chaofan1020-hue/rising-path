'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  ArrowLeft, 
  MapPin, 
  Briefcase, 
  Users, 
  Building, 
  ExternalLink,
  Clock,
  DollarSign,
  FileText,
  Loader2,
  Send,
  Target,
  CheckCircle,
  Star
} from 'lucide-react';
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
  requirements?: string;
  overview?: string;
  responsibilities?: string;
  nice_to_have?: string;
  salary_range: string;
  job_url: string;
  logo_url?: string;
  sponsorship?: 'yes' | 'no' | 'unknown';
  created_at: string;
  // 公司信息（关联查询）
  company_info?: {
    id: number;
    company_name: string;
    careers_url?: string;
    logo_url?: string;
    description?: string;
  };
}

// Company Logo Component
function CompanyLogo({ company, logoUrl }: { company: string; logoUrl?: string }) {
  const [logoError, setLogoError] = useState(false);
  const [clearbitUrl, setClearbitUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!logoUrl && company) {
      // 尝试从 Clearbit 获取 logo
      const domain = company.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .replace(/\s+/g, '');
      setClearbitUrl(`https://logo.clearbit.com/${domain}.com?size=128`);
    }
  }, [company, logoUrl]);

  if (logoUrl && !logoError) {
    return (
      <div className="w-16 h-16 rounded-lg border overflow-hidden bg-white flex-shrink-0">
        <img
          src={logoUrl}
          alt={`${company} logo`}
          className="w-full h-full object-contain p-2"
          onError={() => setLogoError(true)}
        />
      </div>
    );
  }

  if (clearbitUrl && !logoError) {
    return (
      <div className="w-16 h-16 rounded-lg border overflow-hidden bg-white flex-shrink-0">
        <img
          src={clearbitUrl}
          alt={`${company} logo`}
          className="w-full h-full object-contain p-2"
          onError={() => setLogoError(true)}
        />
      </div>
    );
  }

  // Fallback: 首字母
  const initial = company?.charAt(0)?.toUpperCase() || '?';
  return (
    <div className="w-16 h-16 rounded-lg border bg-white flex items-center justify-center flex-shrink-0">
      <span className="text-2xl font-bold text-primary">{initial}</span>
    </div>
  );
}

// 内部组件 - 在 AccessGuard 内部使用 useAccessCode
function JobDetailContent() {
  const params = useParams();
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  
  const { accessCodeId } = useAccessCode();

  useEffect(() => {
    const fetchJob = async () => {
      try {
        const response = await fetch(`/api/jobs/${params.id}`);
        if (!response.ok) {
          throw new Error('岗位不存在');
        }
        const data = await response.json();
        setJob(data.job);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    };

    if (params.id) {
      fetchJob();
      checkIfApplied();
    }
  }, [params.id]);

  // 检查是否已投递
  const checkIfApplied = async () => {
    if (!accessCodeId || !params.id) return;
    try {
      const response = await fetch(`/api/applications?access_code_id=${accessCodeId}`);
      const data = await response.json();
      const hasApplied = (data.applications || []).some((app: { job_id: number }) => app.job_id === Number(params.id));
      setApplied(hasApplied);
    } catch (error) {
      console.error('Failed to check application status:', error);
    }
  };

  // 投递岗位
  const handleApply = async () => {
    if (!accessCodeId) {
      alert('请先登录');
      return;
    }

    if (applied) {
      router.push('/applications');
      return;
    }

    setApplying(true);
    try {
      const response = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: Number(params.id),
          access_code_id: accessCodeId,
          status: 'pending',
          notes: '',
        }),
      });
      
      const data = await response.json();
      
      if (data.application) {
        setApplied(true);
        router.push('/applications');
      } else if (data.error) {
        alert('投递失败: ' + data.error);
      }
    } catch (error) {
      console.error('Failed to apply:', error);
      alert('投递失败，请重试');
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="min-h-screen bg-muted/30 flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">{error || '岗位不存在'}</p>
        <Button onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="container mx-auto px-4 py-4 md:py-8 max-w-4xl">
        {/* Back Button */}
        <Button variant="ghost" className="mb-4 md:mb-6 h-9 text-sm md:text-base" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-1 md:mr-2" />
          返回岗位列表
        </Button>

        {/* Job Header */}
        <Card className="mb-4 md:mb-6">
          <CardContent className="pt-4 md:pt-6">
            {/* 手机端：纵向布局，桌面端：横向布局 */}
            <div className="flex flex-col md:flex-row md:items-start gap-4">
              {/* Logo + 基本信息 */}
              <div className="flex items-start gap-3 md:gap-4 flex-1">
                <CompanyLogo company={job.company} logoUrl={job.logo_url} />
                <div className="flex-1 min-w-0">
                  <h1 className="text-xl md:text-2xl font-bold mb-1 md:mb-2 line-clamp-2">{job.title}</h1>
                  <p className="text-base md:text-lg text-muted-foreground mb-2 md:mb-4">{job.company}</p>
                  
                  {/* 标签区 */}
                  <div className="flex flex-wrap gap-2 md:gap-3">
                    <Badge variant="secondary" className="rounded-md text-xs md:text-sm" translate="no">
                      <MapPin className="h-3 w-3 mr-1" />
                      {job.region}
                    </Badge>
                    <Badge variant="secondary" className="rounded-md text-xs md:text-sm" translate="no">
                      <Briefcase className="h-3 w-3 mr-1" />
                      {job.direction}
                    </Badge>
                    <Badge variant="secondary" className="rounded-md text-xs md:text-sm" translate="no">
                      <Users className="h-3 w-3 mr-1" />
                      {job.audience}
                    </Badge>
                    {job.salary_range && (
                      <Badge variant="outline" className="text-green-600 border-green-600 rounded-md text-xs md:text-sm">
                        <DollarSign className="h-3 w-3 mr-1" />
                        {job.salary_range}
                      </Badge>
                    )}
                    {job.sponsorship && job.sponsorship !== 'unknown' && (
                      <Badge 
                        variant="outline" 
                        className={`rounded-md text-xs md:text-sm ${
                          job.sponsorship === 'yes' 
                            ? 'text-green-600 border-green-600' 
                            : 'text-red-600 border-red-600'
                        }`}
                      >
                        <Target className="h-3 w-3 mr-1" />
                        {job.sponsorship === 'yes' ? '提供Sponsor' : '不提供Sponsor'}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              
              {/* 操作按钮区 - 手机端全宽，桌面端右侧 */}
              <div className="flex flex-col sm:flex-row md:flex-col gap-2 sm:justify-end">
                <Button 
                  className="bg-green-600 hover:bg-green-700 w-full sm:w-auto md:w-auto"
                  onClick={handleApply}
                  disabled={applying}
                >
                  {applying ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      投递中...
                    </>
                  ) : applied ? (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      已投递
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      立即投递
                    </>
                  )}
                </Button>
                {job.job_url && (
                  <Button variant="outline" asChild className="w-full sm:w-auto md:w-auto">
                    <a href={job.job_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      原链接
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 岗位概述 */}
        {job.overview && (
          <Card className="mb-4 md:mb-6 bg-gradient-to-r from-green-50 to-blue-50 border-green-200">
            <CardContent className="pt-4 md:pt-6">
              <p className="text-base md:text-lg text-foreground font-medium leading-relaxed">
                {job.overview}
              </p>
            </CardContent>
          </Card>
        )}

        {/* 岗位职责 */}
        {job.responsibilities && (
          <Card className="mb-4 md:mb-6">
            <CardHeader className="pb-2 md:pb-4">
              <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                <Target className="h-4 w-4 md:h-5 md:w-5 text-green-600" />
                岗位职责
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {job.responsibilities.split('|').filter((item: string) => item.trim()).map((item: string, index: number) => (
                  <li key={index} className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-sm font-medium">
                      {index + 1}
                    </span>
                    <span className="text-sm md:text-base text-muted-foreground leading-relaxed">
                      {item.trim()}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* 岗位要求 */}
        {job.requirements && (
          <Card className="mb-4 md:mb-6">
            <CardHeader className="pb-2 md:pb-4">
              <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                <CheckCircle className="h-4 w-4 md:h-5 md:w-5 text-blue-600" />
                任职要求
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {job.requirements.split('|').filter((item: string) => item.trim()).map((item: string, index: number) => (
                  <li key={index} className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
                    <span className="text-sm md:text-base text-muted-foreground">
                      {item.trim()}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* 加分项 */}
        {job.nice_to_have && (
          <Card className="mb-4 md:mb-6 border-amber-200 bg-amber-50/50">
            <CardHeader className="pb-2 md:pb-4">
              <CardTitle className="flex items-center gap-2 text-base md:text-lg text-amber-800">
                <Star className="h-4 w-4 md:h-5 md:w-5" />
                加分项
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {job.nice_to_have.split('|').filter((item: string) => item.trim()).map((item: string, index: number) => (
                  <li key={index} className="flex items-start gap-3">
                    <Star className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                    <span className="text-sm md:text-base text-amber-700">
                      {item.trim()}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* 原始岗位描述 - 如果没有结构化数据，显示原始描述 */}
        {!job.overview && job.description && (
          <Card className="mb-4 md:mb-6">
            <CardHeader className="pb-2 md:pb-4">
              <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                <FileText className="h-4 w-4 md:h-5 md:w-5" />
                岗位描述
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="whitespace-pre-wrap text-muted-foreground text-sm md:text-base">
                {job.description}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Meta Info */}
        <Card>
          <CardContent className="pt-4 md:pt-6">
            <div className="flex items-center gap-4 text-xs md:text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3 md:h-4 md:w-4" />
                发布时间：{new Date(job.created_at).toLocaleDateString('zh-CN')}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// 默认导出
export default function JobDetailPage() {
  return (
    <AccessGuard>
      <JobDetailContent />
    </AccessGuard>
  );
}
