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
  Loader2
} from 'lucide-react';
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
      <div className="relative w-16 h-16 rounded-lg border overflow-hidden bg-white flex-shrink-0">
        <Image
          src={logoUrl}
          alt={`${company} logo`}
          fill
          className="object-contain p-2"
          onError={() => setLogoError(true)}
        />
      </div>
    );
  }

  if (clearbitUrl && !logoError) {
    return (
      <div className="relative w-16 h-16 rounded-lg border overflow-hidden bg-white flex-shrink-0">
        <Image
          src={clearbitUrl}
          alt={`${company} logo`}
          fill
          className="object-contain p-2"
          onError={() => setLogoError(true)}
          unoptimized
        />
      </div>
    );
  }

  // Fallback: 首字母
  const initial = company?.charAt(0)?.toUpperCase() || '?';
  return (
    <div className="w-16 h-16 rounded-lg border bg-primary/10 flex items-center justify-center flex-shrink-0">
      <span className="text-2xl font-bold text-primary">{initial}</span>
    </div>
  );
}

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    }
  }, [params.id]);

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
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Back Button */}
        <Button variant="ghost" className="mb-6" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回岗位列表
        </Button>

        {/* Job Header */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <CompanyLogo company={job.company} logoUrl={job.logo_url} />
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-bold mb-2">{job.title}</h1>
                <p className="text-lg text-muted-foreground mb-4">{job.company}</p>
                
                <div className="flex flex-wrap gap-3">
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
                      <DollarSign className="h-3 w-3 mr-1" />
                      {job.salary_range}
                    </Badge>
                  )}
                </div>
              </div>
              
              {job.job_url && (
                <Button asChild>
                  <a href={job.job_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    申请岗位
                  </a>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Job Description */}
        {job.description && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                岗位描述
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="whitespace-pre-wrap text-muted-foreground">
                {job.description}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Job Requirements */}
        {job.requirements && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Briefcase className="h-5 w-5" />
                岗位要求
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="whitespace-pre-wrap text-muted-foreground">
                {job.requirements}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Meta Info */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                发布时间：{new Date(job.created_at).toLocaleDateString('zh-CN')}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
