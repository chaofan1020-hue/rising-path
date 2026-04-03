'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  Send, 
  Briefcase, 
  Clock, 
  CheckCircle, 
  XCircle,
  Loader2,
  Plus,
  FileText,
  Calendar,
  Trash2,
  TrendingUp,
  MapPin,
  Building2,
  BarChart3,
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

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这条网申记录吗？')) return;
    
    try {
      const response = await fetch(`/api/applications/${id}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        setApplications(applications.filter(app => app.id !== id));
      } else {
        alert('删除失败');
      }
    } catch (error) {
      console.error('Delete error:', error);
      alert('删除失败');
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
    rejected: applications.filter(a => a.status === 'rejected').length,
    offer: applications.filter(a => a.status === 'offer').length,
  };

  // 投递数据分析
  const analytics = {
    // 状态分布
    statusDistribution: [
      { label: '待投递', count: stats.pending, color: 'bg-yellow-500', percent: stats.total > 0 ? (stats.pending / stats.total * 100).toFixed(0) : 0 },
      { label: '已投递', count: stats.submitted, color: 'bg-blue-500', percent: stats.total > 0 ? (stats.submitted / stats.total * 100).toFixed(0) : 0 },
      { label: '面试中', count: stats.interview, color: 'bg-purple-500', percent: stats.total > 0 ? (stats.interview / stats.total * 100).toFixed(0) : 0 },
      { label: '已拒绝', count: stats.rejected, color: 'bg-red-500', percent: stats.total > 0 ? (stats.rejected / stats.total * 100).toFixed(0) : 0 },
      { label: '已录用', count: stats.offer, color: 'bg-green-500', percent: stats.total > 0 ? (stats.offer / stats.total * 100).toFixed(0) : 0 },
    ],
    // 地区分布
    regionDistribution: applications.reduce((acc, app) => {
      const region = app.jobs?.region || '未知';
      acc[region] = (acc[region] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    // 方向分布
    directionDistribution: applications.reduce((acc, app) => {
      const direction = app.jobs?.direction || '未知';
      acc[direction] = (acc[direction] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    // 投递成功率
    successRate: stats.total > 0 ? ((stats.interview + stats.offer) / stats.total * 100).toFixed(1) : '0',
    // 面试转化率
    interviewRate: stats.submitted > 0 ? (stats.interview / stats.submitted * 100).toFixed(1) : '0',
  };

  // 获取地区分布前5
  const topRegions = Object.entries(analytics.regionDistribution)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  // 获取方向分布前5
  const topDirections = Object.entries(analytics.directionDistribution)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

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

        {/* Analytics Section */}
        {stats.total > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">投递数据分析</h2>
            </div>
            
            <div className="grid md:grid-cols-3 gap-6">
              {/* 状态分布 */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">投递状态分布</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {analytics.statusDistribution.map((item) => (
                      <div key={item.label} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{item.label}</span>
                          <span className="font-medium">{item.count}</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div 
                            className={`h-full ${item.color} transition-all duration-500`}
                            style={{ width: `${item.percent}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* 地区分布 */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    投递地区分布
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {topRegions.length > 0 ? (
                    <div className="space-y-3">
                      {topRegions.map(([region, count], index) => (
                        <div key={region} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${index === 0 ? 'bg-primary' : index === 1 ? 'bg-blue-400' : 'bg-muted-foreground/50'}`} />
                            <span className="text-sm">{region}</span>
                          </div>
                          <Badge variant="secondary" className="font-mono">
                            {count}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">暂无数据</p>
                  )}
                </CardContent>
              </Card>

              {/* 方向分布 */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    投递方向分布
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {topDirections.length > 0 ? (
                    <div className="space-y-3">
                      {topDirections.map(([direction, count], index) => (
                        <div key={direction} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${index === 0 ? 'bg-primary' : index === 1 ? 'bg-blue-400' : 'bg-muted-foreground/50'}`} />
                            <span className="text-sm">{direction}</span>
                          </div>
                          <Badge variant="secondary" className="font-mono">
                            {count}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">暂无数据</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* 核心指标 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
              <Card className="border-l-4 border-l-green-500">
                <CardContent className="pt-4">
                  <div className="text-sm text-muted-foreground mb-1">成功获得面试</div>
                  <div className="text-2xl font-bold text-green-600">
                    {stats.interview + stats.offer}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    占总申请 {analytics.successRate}%
                  </div>
                </CardContent>
              </Card>
              <Card className="border-l-4 border-l-purple-500">
                <CardContent className="pt-4">
                  <div className="text-sm text-muted-foreground mb-1">面试转化率</div>
                  <div className="text-2xl font-bold text-purple-600">
                    {analytics.interviewRate}%
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    已投递 → 面试
                  </div>
                </CardContent>
              </Card>
              <Card className="border-l-4 border-l-blue-500">
                <CardContent className="pt-4">
                  <div className="text-sm text-muted-foreground mb-1">已录用</div>
                  <div className="text-2xl font-bold text-blue-600">
                    {stats.offer}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    求职成果
                  </div>
                </CardContent>
              </Card>
              <Card className="border-l-4 border-l-orange-500">
                <CardContent className="pt-4">
                  <div className="text-sm text-muted-foreground mb-1">待跟进</div>
                  <div className="text-2xl font-bold text-orange-600">
                    {stats.pending + stats.submitted}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    需要继续跟进
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

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
                    <div className="flex items-center gap-3">
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
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/jobs/${app.job_id}`}>
                          查看详情
                        </Link>
                      </Button>
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleDelete(app.id)}
                      >
                        <Trash2 className="h-4 w-4" />
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
