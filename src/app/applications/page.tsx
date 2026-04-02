'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Send, 
  Briefcase, 
  Clock, 
  CheckCircle, 
  XCircle,
  Loader2,
  ExternalLink,
  Plus,
  FileText,
  Calendar,
} from 'lucide-react';
import Link from 'next/link';
import { AccessGuard, useAccessCode } from '@/components/access-guard';

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
  };
  resumes: {
    file_name: string;
  };
}

const statusConfig: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: '待投递', color: 'secondary', icon: Clock },
  submitted: { label: '已投递', color: 'default', icon: Send },
  interview: { label: '面试中', color: 'default', icon: Calendar },
  rejected: { label: '已拒绝', color: 'destructive', icon: XCircle },
  offer: { label: '已录用', color: 'default', icon: CheckCircle },
};

// 内部组件
function ApplicationsContent() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const { accessCodeId } = useAccessCode();

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

  const filteredApplications = statusFilter === 'all' 
    ? applications 
    : applications.filter(app => app.status === statusFilter);

  const getStatusBadge = (status: string) => {
    const config = statusConfig[status] || statusConfig.pending;
    const Icon = config.icon;
    return (
      <Badge variant={config.color as 'default' | 'secondary' | 'destructive'}>
        <Icon className="h-3 w-3 mr-1" />
        {config.label}
      </Badge>
    );
  };

  const stats = {
    total: applications.length,
    pending: applications.filter(a => a.status === 'pending').length,
    submitted: applications.filter(a => a.status === 'submitted').length,
    interview: applications.filter(a => a.status === 'interview').length,
    offer: applications.filter(a => a.status === 'offer').length,
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Briefcase className="h-6 w-6 text-primary" />
            <span className="font-bold text-xl">PathUp</span>
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/jobs">
              <Button variant="ghost" size="sm">岗位查询</Button>
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
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
            <Send className="h-8 w-8 text-cyan-600" />
            网申管理
          </h1>
          <p className="text-muted-foreground">
            管理你的网申记录，追踪申请进度
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-sm text-muted-foreground">总申请</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
              <div className="text-sm text-muted-foreground">待投递</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="text-2xl font-bold text-blue-600">{stats.submitted}</div>
              <div className="text-sm text-muted-foreground">已投递</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="text-2xl font-bold text-purple-600">{stats.interview}</div>
              <div className="text-sm text-muted-foreground">面试中</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="text-2xl font-bold text-green-600">{stats.offer}</div>
              <div className="text-sm text-muted-foreground">已录用</div>
            </CardContent>
          </Card>
        </div>

        {/* Applications List */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>申请列表</CardTitle>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="状态筛选" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="pending">待投递</SelectItem>
                  <SelectItem value="submitted">已投递</SelectItem>
                  <SelectItem value="interview">面试中</SelectItem>
                  <SelectItem value="rejected">已拒绝</SelectItem>
                  <SelectItem value="offer">已录用</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-12 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                加载中...
              </div>
            ) : filteredApplications.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Send className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>暂无网申记录</p>
                <Link href="/jobs">
                  <Button className="mt-4">
                    <Plus className="mr-2 h-4 w-4" />
                    去投递岗位
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredApplications.map((app) => (
                  <div
                    key={app.id}
                    className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-lg bg-cyan-100 dark:bg-cyan-900 flex items-center justify-center flex-shrink-0">
                        <Briefcase className="h-5 w-5 text-cyan-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold">{app.jobs?.title || '未知岗位'}</h3>
                        <p className="text-sm text-muted-foreground">{app.jobs?.company || '未知公司'}</p>
                        <div className="flex items-center gap-2 mt-2">
                          {getStatusBadge(app.status)}
                          <Badge variant="outline">{app.jobs?.region}</Badge>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right text-sm">
                        <p className="text-muted-foreground">
                          创建于 {new Date(app.created_at).toLocaleDateString()}
                        </p>
                        {app.submitted_at && (
                          <p className="text-muted-foreground">
                            投递于 {new Date(app.submitted_at).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      <Button size="sm" variant="outline">
                        查看详情
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Auto-fill Feature Info */}
        <Card className="mt-8 border-cyan-200 bg-cyan-50 dark:bg-cyan-950/20">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-cyan-100 dark:bg-cyan-900 flex items-center justify-center flex-shrink-0">
                <FileText className="h-6 w-6 text-cyan-600" />
              </div>
              <div>
                <h4 className="font-medium mb-2">自动网申功能</h4>
                <p className="text-sm text-muted-foreground mb-4">
                  系统将学习您的简历信息和填写习惯，自动填写企业网申表单。支持字段映射和智能填充，大幅提升投递效率。
                </p>
                <div className="flex gap-2">
                  <Badge variant="secondary">字段学习</Badge>
                  <Badge variant="secondary">自动填充</Badge>
                  <Badge variant="secondary">批量投递</Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

// 主组件
export default function ApplicationsPage() {
  return (
    <AccessGuard>
      <ApplicationsContent />
    </AccessGuard>
  );
}
