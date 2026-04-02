'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { AdminAuthGuard } from '@/components/admin-auth-guard';
import { 
  LayoutDashboard,
  Briefcase,
  FileText,
  Send,
  Users,
  Globe,
  GraduationCap,
  Plus,
  Edit,
  Trash2,
  Search,
  ExternalLink,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  Calendar,
  LogOut,
} from 'lucide-react';
import Link from 'next/link';

// Types
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

interface Resume {
  id: number;
  file_key: string;
  file_name: string;
  parsed_content: string;
  user_info: Record<string, unknown>;
  created_at: string;
}

interface Application {
  id: number;
  job_id: number;
  resume_id: number;
  status: string;
  notes: string;
  submitted_at: string;
  created_at: string;
  jobs: { title: string; company: string };
  resumes: { file_name: string };
}

const regions = ['北美', '欧洲', '亚太', '澳洲', '中东'];
const directions = ['技术', '产品', '设计', '运营', '市场', '金融', '咨询'];
const audiences = ['应届生', '社招', '实习', '校招'];
const statusOptions = ['pending', 'submitted', 'interview', 'rejected', 'offer'];

const statusLabels: Record<string, string> = {
  pending: '待投递',
  submitted: '已投递',
  interview: '面试中',
  rejected: '已拒绝',
  offer: '已录用',
};

export default function AdminPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);

  // Job form state
  const [jobForm, setJobForm] = useState({
    title: '',
    company: '',
    region: '北美',
    direction: '技术',
    audience: '应届生',
    description: '',
    requirements: '',
    salary_range: '',
    job_url: '',
    logo_url: '',
  });
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [deleteJobId, setDeleteJobId] = useState<number | null>(null);

  // Application form state
  const [editingApp, setEditingApp] = useState<Application | null>(null);
  const [appDialogOpen, setAppDialogOpen] = useState(false);

  // Search state
  const [jobSearch, setJobSearch] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [jobsRes, resumesRes, appsRes] = await Promise.all([
        fetch('/api/jobs'),
        fetch('/api/resume'),
        fetch('/api/applications'),
      ]);
      const jobsData = await jobsRes.json();
      const resumesData = await resumesRes.json();
      const appsData = await appsRes.json();
      setJobs(jobsData.jobs || []);
      setResumes(resumesData.resumes || []);
      setApplications(appsData.applications || []);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Job CRUD
  const handleCreateJob = async () => {
    try {
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobForm),
      });
      const data = await response.json();
      if (data.job) {
        setJobs([data.job, ...jobs]);
        resetJobForm();
        setJobDialogOpen(false);
      }
    } catch (error) {
      console.error('Failed to create job:', error);
    }
  };

  const handleUpdateJob = async () => {
    if (!editingJob) return;
    try {
      const response = await fetch(`/api/jobs/${editingJob.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobForm),
      });
      const data = await response.json();
      if (data.job) {
        setJobs(jobs.map(j => j.id === data.job.id ? data.job : j));
        resetJobForm();
        setEditingJob(null);
        setJobDialogOpen(false);
      }
    } catch (error) {
      console.error('Failed to update job:', error);
    }
  };

  const handleDeleteJob = async (id: number) => {
    try {
      await fetch(`/api/jobs/${id}`, { method: 'DELETE' });
      setJobs(jobs.filter(j => j.id !== id));
      setDeleteJobId(null);
    } catch (error) {
      console.error('Failed to delete job:', error);
    }
  };

  const resetJobForm = () => {
    setJobForm({
      title: '',
      company: '',
      region: '北美',
      direction: '技术',
      audience: '应届生',
      description: '',
      requirements: '',
      salary_range: '',
      job_url: '',
      logo_url: '',
    });
  };

  const openEditJob = (job: Job) => {
    setEditingJob(job);
    setJobForm({
      title: job.title,
      company: job.company,
      region: job.region,
      direction: job.direction,
      audience: job.audience,
      description: job.description || '',
      requirements: job.requirements || '',
      salary_range: job.salary_range || '',
      job_url: job.job_url || '',
      logo_url: job.logo_url || '',
    });
    setJobDialogOpen(true);
  };

  // Application CRUD
  const handleUpdateApplication = async () => {
    if (!editingApp) return;
    try {
      const response = await fetch(`/api/applications/${editingApp.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          status: editingApp.status, 
          notes: editingApp.notes 
        }),
      });
      const data = await response.json();
      if (data.application) {
        setApplications(applications.map(a => a.id === data.application.id ? data.application : a));
        setEditingApp(null);
        setAppDialogOpen(false);
      }
    } catch (error) {
      console.error('Failed to update application:', error);
    }
  };

  const handleDeleteResume = async (id: number) => {
    try {
      await fetch(`/api/resume/${id}`, { method: 'DELETE' });
      setResumes(resumes.filter(r => r.id !== id));
    } catch (error) {
      console.error('Failed to delete resume:', error);
    }
  };

  // Stats
  const stats = {
    totalJobs: jobs.length,
    totalResumes: resumes.length,
    totalApplications: applications.length,
    pendingApps: applications.filter(a => a.status === 'pending').length,
    submittedApps: applications.filter(a => a.status === 'submitted').length,
    interviewApps: applications.filter(a => a.status === 'interview').length,
    offerApps: applications.filter(a => a.status === 'offer').length,
  };

  const filteredJobs = jobs.filter(
    job => 
      job.title.toLowerCase().includes(jobSearch.toLowerCase()) ||
      job.company.toLowerCase().includes(jobSearch.toLowerCase())
  );

  return (
    <AdminAuthGuard>
      <div className="min-h-screen bg-muted/30">
        {/* Header */}
        <header className="border-b bg-background sticky top-0 z-50">
          <div className="container mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <LayoutDashboard className="h-6 w-6 text-primary" />
              <span className="font-bold text-xl">管理后台</span>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/">
                <Button variant="outline" size="sm">
                  返回首页
                </Button>
              </Link>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => {
                  localStorage.removeItem('admin_auth');
                  window.location.reload();
                }}
              >
                <LogOut className="h-4 w-4 mr-1" />
                退出登录
              </Button>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-8">
        {loading ? (
          <div className="text-center py-12">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="mt-2 text-muted-foreground">加载中...</p>
          </div>
        ) : (
          <Tabs defaultValue="overview" className="space-y-6">
            <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
              <TabsTrigger value="overview">
                <LayoutDashboard className="h-4 w-4 mr-2" />
                概览
              </TabsTrigger>
              <TabsTrigger value="jobs">
                <Briefcase className="h-4 w-4 mr-2" />
                岗位管理
              </TabsTrigger>
              <TabsTrigger value="resumes">
                <FileText className="h-4 w-4 mr-2" />
                简历管理
              </TabsTrigger>
              <TabsTrigger value="applications">
                <Send className="h-4 w-4 mr-2" />
                网申管理
              </TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview">
              <div className="grid gap-6">
                {/* Stats Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2">
                        <Briefcase className="h-5 w-5 text-blue-600" />
                        <span className="text-2xl font-bold">{stats.totalJobs}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">岗位总数</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-green-600" />
                        <span className="text-2xl font-bold">{stats.totalResumes}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">简历总数</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2">
                        <Send className="h-5 w-5 text-purple-600" />
                        <span className="text-2xl font-bold">{stats.totalApplications}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">网申总数</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2">
                        <Clock className="h-5 w-5 text-yellow-600" />
                        <span className="text-2xl font-bold">{stats.pendingApps}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">待投递</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-5 w-5 text-blue-600" />
                        <span className="text-2xl font-bold">{stats.submittedApps}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">已投递</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-5 w-5 text-purple-600" />
                        <span className="text-2xl font-bold">{stats.interviewApps}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">面试中</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-5 w-5 text-green-600" />
                        <span className="text-2xl font-bold">{stats.offerApps}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">已录用</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Quick Actions */}
                <div className="grid md:grid-cols-3 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">岗位分布</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {regions.map(region => {
                          const count = jobs.filter(j => j.region === region).length;
                          return (
                            <div key={region} className="flex items-center justify-between">
                              <span className="text-sm">{region}</span>
                              <Badge variant="secondary">{count} 个岗位</Badge>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">方向分布</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {directions.map(dir => {
                          const count = jobs.filter(j => j.direction === dir).length;
                          return (
                            <div key={dir} className="flex items-center justify-between">
                              <span className="text-sm">{dir}</span>
                              <Badge variant="secondary">{count} 个岗位</Badge>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">受众分布</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {audiences.map(aud => {
                          const count = jobs.filter(j => j.audience === aud).length;
                          return (
                            <div key={aud} className="flex items-center justify-between">
                              <span className="text-sm">{aud}</span>
                              <Badge variant="secondary">{count} 个岗位</Badge>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            {/* Jobs Tab */}
            <TabsContent value="jobs">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>岗位管理</CardTitle>
                      <CardDescription>添加、编辑和删除岗位信息</CardDescription>
                    </div>
                    <Dialog open={jobDialogOpen} onOpenChange={(open) => {
                      setJobDialogOpen(open);
                      if (!open) {
                        resetJobForm();
                        setEditingJob(null);
                      }
                    }}>
                      <DialogTrigger asChild>
                        <Button>
                          <Plus className="h-4 w-4 mr-2" />
                          添加岗位
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>{editingJob ? '编辑岗位' : '添加新岗位'}</DialogTitle>
                          <DialogDescription>
                            填写岗位信息，带 * 的为必填项
                          </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label htmlFor="title">岗位名称 *</Label>
                              <Input
                                id="title"
                                value={jobForm.title}
                                onChange={(e) => setJobForm({ ...jobForm, title: e.target.value })}
                                placeholder="如：Software Engineer"
                              />
                            </div>
                            <div>
                              <Label htmlFor="company">公司名称 *</Label>
                              <Input
                                id="company"
                                value={jobForm.company}
                                onChange={(e) => setJobForm({ ...jobForm, company: e.target.value })}
                                placeholder="如：Google"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-4">
                            <div>
                              <Label>地区 *</Label>
                              <Select value={jobForm.region} onValueChange={(v) => setJobForm({ ...jobForm, region: v })}>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {regions.map(r => (
                                    <SelectItem key={r} value={r}>{r}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label>方向 *</Label>
                              <Select value={jobForm.direction} onValueChange={(v) => setJobForm({ ...jobForm, direction: v })}>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {directions.map(d => (
                                    <SelectItem key={d} value={d}>{d}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label>受众 *</Label>
                              <Select value={jobForm.audience} onValueChange={(v) => setJobForm({ ...jobForm, audience: v })}>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {audiences.map(a => (
                                    <SelectItem key={a} value={a}>{a}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label htmlFor="salary">薪资范围</Label>
                              <Input
                                id="salary"
                                value={jobForm.salary_range}
                                onChange={(e) => setJobForm({ ...jobForm, salary_range: e.target.value })}
                                placeholder="如：$120K - $180K"
                              />
                            </div>
                            <div>
                              <Label htmlFor="url">岗位链接</Label>
                              <Input
                                id="url"
                                value={jobForm.job_url}
                                onChange={(e) => setJobForm({ ...jobForm, job_url: e.target.value })}
                                placeholder="https://..."
                              />
                            </div>
                          </div>
                          <div>
                            <Label htmlFor="logo">公司Logo URL</Label>
                            <Input
                              id="logo"
                              value={jobForm.logo_url}
                              onChange={(e) => setJobForm({ ...jobForm, logo_url: e.target.value })}
                              placeholder="可选，留空则自动获取或显示首字母"
                            />
                          </div>
                          <div>
                            <Label htmlFor="desc">岗位描述</Label>
                            <Textarea
                              id="desc"
                              value={jobForm.description}
                              onChange={(e) => setJobForm({ ...jobForm, description: e.target.value })}
                              placeholder="岗位描述..."
                              rows={3}
                            />
                          </div>
                          <div>
                            <Label htmlFor="req">岗位要求</Label>
                            <Textarea
                              id="req"
                              value={jobForm.requirements}
                              onChange={(e) => setJobForm({ ...jobForm, requirements: e.target.value })}
                              placeholder="岗位要求..."
                              rows={3}
                            />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => {
                            setJobDialogOpen(false);
                            resetJobForm();
                            setEditingJob(null);
                          }}>
                            取消
                          </Button>
                          <Button 
                            onClick={editingJob ? handleUpdateJob : handleCreateJob}
                            disabled={!jobForm.title || !jobForm.company}
                          >
                            {editingJob ? '保存修改' : '添加岗位'}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                </CardHeader>
                <CardContent>
                  {/* Search */}
                  <div className="mb-4">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="搜索岗位名称或公司..."
                        value={jobSearch}
                        onChange={(e) => setJobSearch(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  </div>

                  {/* Jobs Table */}
                  <div className="border rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-4 py-3 text-left text-sm font-medium">岗位</th>
                            <th className="px-4 py-3 text-left text-sm font-medium">公司</th>
                            <th className="px-4 py-3 text-left text-sm font-medium">地区</th>
                            <th className="px-4 py-3 text-left text-sm font-medium">方向</th>
                            <th className="px-4 py-3 text-left text-sm font-medium">受众</th>
                            <th className="px-4 py-3 text-left text-sm font-medium">薪资</th>
                            <th className="px-4 py-3 text-right text-sm font-medium">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {filteredJobs.map((job) => (
                            <tr key={job.id} className="hover:bg-muted/30">
                              <td className="px-4 py-3 text-sm font-medium">{job.title}</td>
                              <td className="px-4 py-3 text-sm">{job.company}</td>
                              <td className="px-4 py-3 text-sm">
                                <Badge variant="outline">{job.region}</Badge>
                              </td>
                              <td className="px-4 py-3 text-sm">{job.direction}</td>
                              <td className="px-4 py-3 text-sm">{job.audience}</td>
                              <td className="px-4 py-3 text-sm text-green-600">{job.salary_range}</td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex justify-end gap-2">
                                  {job.job_url && (
                                    <Button size="sm" variant="ghost" asChild>
                                      <a href={job.job_url} target="_blank" rel="noopener noreferrer">
                                        <ExternalLink className="h-4 w-4" />
                                      </a>
                                    </Button>
                                  )}
                                  <Button size="sm" variant="ghost" onClick={() => openEditJob(job)}>
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  <Button 
                                    size="sm" 
                                    variant="ghost" 
                                    className="text-destructive"
                                    onClick={() => setDeleteJobId(job.id)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {filteredJobs.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">
                        暂无岗位数据
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Resumes Tab */}
            <TabsContent value="resumes">
              <Card>
                <CardHeader>
                  <CardTitle>简历管理</CardTitle>
                  <CardDescription>查看和管理已上传的简历</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="border rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-4 py-3 text-left text-sm font-medium">文件名</th>
                            <th className="px-4 py-3 text-left text-sm font-medium">上传时间</th>
                            <th className="px-4 py-3 text-left text-sm font-medium">解析状态</th>
                            <th className="px-4 py-3 text-right text-sm font-medium">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {resumes.map((resume) => (
                            <tr key={resume.id} className="hover:bg-muted/30">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <FileText className="h-4 w-4 text-muted-foreground" />
                                  <span className="text-sm font-medium">{resume.file_name}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-sm text-muted-foreground">
                                {new Date(resume.created_at).toLocaleString()}
                              </td>
                              <td className="px-4 py-3">
                                <Badge variant={resume.parsed_content ? 'default' : 'secondary'}>
                                  {resume.parsed_content ? '已解析' : '待解析'}
                                </Badge>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <Button 
                                  size="sm" 
                                  variant="ghost" 
                                  className="text-destructive"
                                  onClick={() => handleDeleteResume(resume.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {resumes.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">
                        暂无简历数据
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Applications Tab */}
            <TabsContent value="applications">
              <Card>
                <CardHeader>
                  <CardTitle>网申管理</CardTitle>
                  <CardDescription>查看和管理网申记录</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="border rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-4 py-3 text-left text-sm font-medium">岗位</th>
                            <th className="px-4 py-3 text-left text-sm font-medium">公司</th>
                            <th className="px-4 py-3 text-left text-sm font-medium">状态</th>
                            <th className="px-4 py-3 text-left text-sm font-medium">创建时间</th>
                            <th className="px-4 py-3 text-left text-sm font-medium">备注</th>
                            <th className="px-4 py-3 text-right text-sm font-medium">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {applications.map((app) => (
                            <tr key={app.id} className="hover:bg-muted/30">
                              <td className="px-4 py-3 text-sm font-medium">
                                {app.jobs?.title || '未知岗位'}
                              </td>
                              <td className="px-4 py-3 text-sm">
                                {app.jobs?.company || '未知公司'}
                              </td>
                              <td className="px-4 py-3">
                                <Badge variant={app.status === 'offer' ? 'default' : app.status === 'rejected' ? 'destructive' : 'secondary'}>
                                  {statusLabels[app.status] || app.status}
                                </Badge>
                              </td>
                              <td className="px-4 py-3 text-sm text-muted-foreground">
                                {new Date(app.created_at).toLocaleDateString()}
                              </td>
                              <td className="px-4 py-3 text-sm text-muted-foreground max-w-48 truncate">
                                {app.notes || '-'}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <Button 
                                  size="sm" 
                                  variant="ghost"
                                  onClick={() => {
                                    setEditingApp(app);
                                    setAppDialogOpen(true);
                                  }}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {applications.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">
                        暂无网申记录
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </main>

      {/* Delete Job Confirmation */}
      <AlertDialog open={!!deleteJobId} onOpenChange={() => setDeleteJobId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              此操作将永久删除该岗位，删除后无法恢复。确定要继续吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction 
              className="bg-destructive text-destructive-foreground"
              onClick={() => deleteJobId && handleDeleteJob(deleteJobId)}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Application Dialog */}
      <Dialog open={appDialogOpen} onOpenChange={(open) => {
        setAppDialogOpen(open);
        if (!open) setEditingApp(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑网申状态</DialogTitle>
          </DialogHeader>
          {editingApp && (
            <div className="space-y-4 py-4">
              <div>
                <Label>状态</Label>
                <Select 
                  value={editingApp.status} 
                  onValueChange={(v) => setEditingApp({ ...editingApp, status: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map(s => (
                      <SelectItem key={s} value={s}>{statusLabels[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>备注</Label>
                <Textarea
                  value={editingApp.notes || ''}
                  onChange={(e) => setEditingApp({ ...editingApp, notes: e.target.value })}
                  placeholder="添加备注..."
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAppDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleUpdateApplication}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </AdminAuthGuard>
  );
}
