'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { AccessGuard, useAccessCode } from '@/components/access-guard';
import { StepProgressBar } from '@/components/step-progress-bar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Mail, CheckCircle, Clock, Briefcase, ArrowRight, RefreshCw,
} from 'lucide-react';

interface Application {
  id: number;
  job_id: number;
  resume_id: number;
  status: string;
  notes: string;
  submitted_at: string;
  created_at: string;
  jobs: {
    title: string;
    company: string;
    region: string;
    direction: string;
    job_url: string;
  };
  resumes: {
    file_name: string;
  };
}

function ApplicationsContent() {
  const { accessCodeId } = useAccessCode();
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (accessCodeId) {
      fetchApplications();
    }
  }, [accessCodeId]);

  const fetchApplications = async () => {
    if (!accessCodeId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('access_code_id', accessCodeId.toString());
      const response = await fetch(`/api/applications?${params.toString()}`);
      const data = await response.json();
      setApplications(data.applications || []);
    } catch (error) {
      console.error('Failed to fetch applications:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'submitted':
        return <Badge className="bg-blue-600 text-xs"><Send className="mr-1 h-3 w-3" />已投递</Badge>;
      case 'viewed':
        return <Badge className="bg-yellow-600 text-xs"><Eye className="mr-1 h-3 w-3" />已查看</Badge>;
      case 'interview':
        return <Badge className="bg-green-600 text-xs"><CheckCircle className="mr-1 h-3 w-3" />面试邀请</Badge>;
      case 'rejected':
        return <Badge variant="destructive" className="text-xs"><XCircle className="mr-1 h-3 w-3" />已拒绝</Badge>;
      case 'offered':
        return <Badge className="bg-purple-600 text-xs"><CheckCircle className="mr-1 h-3 w-3" />Offer</Badge>;
      default:
        return <Badge variant="secondary" className="text-xs">{status}</Badge>;
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const email = typeof window !== 'undefined' ? localStorage.getItem('risingpath_step4_email') || '' : '';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.svg" alt="Rising Path" width={28} height={28} className="rounded" />
            <span className="font-bold text-lg md:text-xl">Rising Path</span>
          </Link>
        </div>
      </header>

      {/* Step Progress Bar */}
      <div className="border-b bg-muted/30">
        <div className="container mx-auto px-4 py-3">
          <StepProgressBar currentStep={5} />
        </div>
      </div>

      <main className="container mx-auto px-4 py-4 md:py-8 max-w-5xl">
        {/* Page Title */}
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-1 md:mb-2 flex items-center gap-2 md:gap-3">
            <Mail className="h-6 w-6 md:h-8 md:w-8 text-purple-600" />
            投递记录 & 邮箱回执
          </h1>
          <p className="text-sm md:text-base text-muted-foreground">
            查看所有投递记录和状态，回执已发送至你的邮箱
          </p>
        </div>

        {/* Email Info */}
        {email && (
          <Card className="mb-6 border-green-200 bg-green-50/50 dark:bg-green-950/20">
            <CardContent className="py-3">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-green-600" />
                <span className="text-sm">回执邮箱: <strong>{email}</strong></span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card>
            <CardContent className="py-3 text-center">
              <div className="text-2xl font-bold">{applications.length}</div>
              <div className="text-xs text-muted-foreground">总投递</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 text-center">
              <div className="text-2xl font-bold text-blue-600">
                {applications.filter(a => a.status === 'submitted').length}
              </div>
              <div className="text-xs text-muted-foreground">已投递</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 text-center">
              <div className="text-2xl font-bold text-green-600">
                {applications.filter(a => a.status === 'interview' || a.status === 'offered').length}
              </div>
              <div className="text-xs text-muted-foreground">面试/Offer</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 text-center">
              <div className="text-2xl font-bold text-red-500">
                {applications.filter(a => a.status === 'rejected').length}
              </div>
              <div className="text-xs text-muted-foreground">已拒绝</div>
            </CardContent>
          </Card>
        </div>

        {/* Refresh */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4" />
            投递记录
          </h2>
          <Button variant="outline" size="sm" onClick={fetchApplications} disabled={loading}>
            <RefreshCw className={`mr-1 h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>

        {/* Application List */}
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin h-8 w-8 border-2 border-purple-600 border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">加载中...</p>
          </div>
        ) : applications.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <Mail className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium mb-2">暂无投递记录</h3>
              <p className="text-sm text-muted-foreground mb-6">完成岗位投递后，记录将在此展示</p>
              <Button onClick={() => window.location.href = '/resume'} className="bg-gradient-to-r from-purple-600 to-blue-600">
                开始求职之旅
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {applications.map((app) => (
              <Card key={app.id} className="hover:shadow-md transition-all">
                <CardContent className="py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0">
                      <Briefcase className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <h3 className="font-semibold text-sm">{app.jobs?.title || '未知岗位'}</h3>
                        {getStatusBadge(app.status)}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{app.jobs?.company || '未知公司'}</span>
                        <span>·</span>
                        <span>{app.jobs?.region || ''}</span>
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <div className="text-xs text-muted-foreground">
                        {formatDate(app.submitted_at || app.created_at)}
                      </div>
                      {app.notes && (
                        <div className="text-[10px] text-muted-foreground mt-1 max-w-[150px] truncate">
                          {app.notes}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Complete Banner */}
        {applications.length > 0 && (
          <Card className="mt-8 border-green-200 bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-950/20 dark:to-blue-950/20">
            <CardContent className="py-6 text-center">
              <CheckCircle className="h-12 w-12 mx-auto mb-3 text-green-600" />
              <h3 className="text-lg font-semibold mb-1">投递流程完成！</h3>
              <p className="text-sm text-muted-foreground mb-4">
                已向 {applications.length} 个岗位提交申请，回执已发送至 {email || '你的邮箱'}
              </p>
              <div className="flex items-center justify-center gap-3">
                <Button variant="outline" onClick={() => window.location.href = '/'}>
                  返回首页
                </Button>
                <Button onClick={() => window.location.href = '/resume'} className="bg-gradient-to-r from-purple-600 to-blue-600">
                  开始新一轮投递
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

// Need Eye and XCircle imports for status badges
function Eye(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function Send(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function XCircle(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  );
}

export default function ApplicationsPage() {
  return (
    <AccessGuard>
      <ApplicationsContent />
    </AccessGuard>
  );
}
