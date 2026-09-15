'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Plus, Edit, Trash2, Search, ExternalLink, Loader2, Upload, FileText, FileSpreadsheet, Globe, Download, ChevronLeft, ChevronRight, CheckCircle, XCircle, X } from 'lucide-react';
import Link from 'next/link';
import { useAdminPermissions } from '@/components/admin-shell';
import { AdminPageShell } from '@/components/admin/page-shell';
import { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';

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

interface CompanyConfig {
  id: number;
  company_name: string;
  careers_page: string;
  ats_type: string;
  ats_id: string;
  logo_url: string;
}

export function AdminJobsPanel() {
  const { hasPermission } = useAdminPermissions();
  const canWriteJobs = hasPermission(ADMIN_PERMISSIONS.jobsWrite);
  const canWriteConfig = hasPermission(ADMIN_PERMISSIONS.configWrite);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsPage, setJobsPage] = useState(0);
  const jobsPageSize = 50;
  const [jobsTotal, setJobsTotal] = useState(0);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState('');
  const jobsRequestRef = useRef(0);
  const [configs, setConfigs] = useState<Record<string, JobConfig[]>>({ region: [], direction: [], audience: [] });
  const [companies, setCompanies] = useState<CompanyConfig[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [jobForm, setJobForm] = useState({ title: '', company: '', region: '', direction: '', audience: '', description: '', requirements: '', salary_range: '', job_url: '', logo_url: '', is_active: true });
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [deleteJobId, setDeleteJobId] = useState<number | null>(null);
  const [jobSearch, setJobSearch] = useState('');
  const [batchImportOpen, setBatchImportOpen] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [batchImporting, setBatchImporting] = useState(false);
  const [batchResult, setBatchResult] = useState<{ success?: boolean; created?: number; skipped?: number; total?: number; invalidCount?: number; invalidJobs?: { index: number; reason: string; data: Record<string, unknown> }[] } | null>(null);
  const [importMode, setImportMode] = useState<'file' | 'text'>('file');
  const [previewJobs, setPreviewJobs] = useState<Job[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [selectedJobIds, setSelectedJobIds] = useState<Set<number>>(new Set());
  const [batchDeleteConfirmOpen, setBatchDeleteConfirmOpen] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);

  const fetchJobOptions = async () => {
    try {
      const response = await fetch('/api/configs', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '岗位选项加载失败');
      setConfigs(data.configs || {});
      if (data.configs?.region?.[0]) setJobForm((prev) => ({ ...prev, region: prev.region || data.configs.region[0].config_value }));
      if (data.configs?.direction?.[0]) setJobForm((prev) => ({ ...prev, direction: prev.direction || data.configs.direction[0].config_value }));
      if (data.configs?.audience?.[0]) setJobForm((prev) => ({ ...prev, audience: prev.audience || data.configs.audience[0].config_value }));
    } catch (error) {
      console.error('Failed to fetch job options:', error);
    }
  };

  const fetchJobsPage = async (requestedPage = jobsPage, requestedSearch = jobSearch) => {
    const requestId = ++jobsRequestRef.current;
    setJobsLoading(true);
    setJobsError('');
    try {
      const params = new URLSearchParams({
        limit: String(jobsPageSize),
        offset: String(requestedPage * jobsPageSize),
        status: 'active',
      });
      if (requestedSearch.trim()) params.set('search', requestedSearch.trim());
      const response = await fetch(`/api/jobs?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '岗位加载失败');
      if (requestId !== jobsRequestRef.current) return;
      setJobs(data.jobs || []);
      setJobsTotal(data.pagination?.total || 0);
      setSelectedJobIds(new Set());
    } catch (error) {
      if (requestId !== jobsRequestRef.current) return;
      console.error('Failed to fetch jobs:', error);
      setJobsError(error instanceof Error ? error.message : '岗位加载失败');
    } finally {
      if (requestId === jobsRequestRef.current) setJobsLoading(false);
    }
  };

  useEffect(() => {
    void fetchJobsPage();
  }, [jobSearch, jobsPage]);

  useEffect(() => {
    void fetchJobOptions();
    if (!canWriteConfig) return;
    void Promise.all([
      fetch('/api/admin/configs?page=1&pageSize=100'),
      fetch('/api/admin/company-config'),
    ]).then(async ([configsRes, companiesRes]) => {
      const configsData = await configsRes.json();
      const companiesData = await companiesRes.json();
      if (configsRes.ok) setConfigs(configsData.configs || {});
      if (companiesRes.ok) setCompanies(companiesData.companies || []);
    }).catch((error) => console.error('Failed to fetch job form catalogs:', error));
  }, [canWriteConfig]);

  const handleCreateJob = async () => {
    try {
      // 如果填写了公司名称，自动关联公司
      let company_id = null;
      if (jobForm.company) {
        const matchedCompany = companies.find(
          c => c.company_name.toLowerCase() === jobForm.company.toLowerCase()
        );
        if (matchedCompany) {
          company_id = matchedCompany.id;
        }
      }

      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...jobForm, company_id }),
      });
      const data = await response.json();
      if (data.job) {
        await fetchJobsPage(0, jobSearch);
        resetJobForm();
        setJobDialogOpen(false);
      } else if (!response.ok) {
        alert(data.error || '添加岗位失败');
      }
    } catch (error) {
      console.error('Failed to create job:', error);
      alert('添加岗位失败，请稍后重试');
    }
  };

  // Batch import jobs
  const parseBatchText = (text: string) => {
    const lines = text.trim().split('\n').filter(line => line.trim());
    const jobs: Array<{
      title: string;
      company: string;
      region: string;
      direction: string;
      audience: string;
      salary_range?: string;
      job_url?: string;
      description?: string;
    }> = [];

    for (const line of lines) {
      // 支持多种分隔符：| 或 Tab 或 ,
      const parts = line.split(/[|\t,]/).map(p => p.trim()).filter(p => p);
      
      if (parts.length >= 5) {
        jobs.push({
          title: parts[0],
          company: parts[1],
          region: parts[2],
          direction: parts[3],
          audience: parts[4],
          salary_range: parts[5] || '',
          job_url: parts[6] || '',
          description: parts[7] || '',
        });
      }
    }

    return jobs;
  };

  const handleBatchImport = async () => {
    // 根据模式获取要导入的数据
    let jobsToImport: Array<{
      title: string;
      company: string;
      region: string;
      direction: string;
      audience: string;
      salary_range?: string;
      job_url?: string;
      description?: string;
    }> = [];

    if (importMode === 'file') {
      jobsToImport = previewJobs.map(j => ({
        title: j.title,
        company: j.company,
        region: j.region,
        direction: j.direction,
        audience: j.audience,
        salary_range: j.salary_range || '',
        job_url: j.job_url || '',
        description: j.description || '',
      }));
    } else {
      jobsToImport = parseBatchText(batchText);
    }
    
    if (jobsToImport.length === 0) {
      setBatchResult({
        success: false,
        created: 0,
        total: 0,
        invalidCount: 1,
        invalidJobs: [{ index: 0, reason: '无法解析任何有效岗位，请检查格式', data: {} }]
      });
      return;
    }

    setBatchImporting(true);
    try {
      const response = await fetch('/api/jobs/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobs: jobsToImport }),
      });
      const data = await response.json();
      
      setBatchResult({
        success: data.success,
        created: data.created,
        skipped: data.skipped,
        total: data.total,
        invalidCount: data.invalidCount,
        invalidJobs: data.invalidJobs
      });

      if (data.success && data.created > 0) {
        await fetchJobsPage();
      }
    } catch (error) {
      console.error('Failed to batch import:', error);
      setBatchResult({
        success: false,
        created: 0,
        total: jobsToImport.length,
        invalidCount: jobsToImport.length,
        invalidJobs: [{ index: 0, reason: '导入失败，请稍后重试', data: {} }]
      });
    } finally {
      setBatchImporting(false);
    }
  };

  const resetBatchImport = () => {
    setBatchText('');
    setBatchResult(null);
    setPreviewJobs([]);
    setUploadedFileName('');
    setBatchImportOpen(false);
  };
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      // 使用 /api/upload 解析 Excel/CSV 文件
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        alert(`文件解析失败: ${error.error || '未知错误'}`);
        return;
      }

      const data = await response.json();
      
      if (data.data && Array.isArray(data.data) && data.data.length > 0) {
        // 转换数据格式
        const parsedJobs = data.data.map((row: Record<string, string>, idx: number) => ({
          title: row['岗位名称'] || row['title'] || row[`岗位名称(${idx + 1})`] || '',
          company: row['公司名称'] || row['company'] || row[`公司名称(${idx + 1})`] || '',
          region: row['地区'] || row['region'] || row['工作地区'] || row[`地区(${idx + 1})`] || '',
          direction: row['方向'] || row['direction'] || row['岗位方向'] || row[`方向(${idx + 1})`] || '',
          audience: row['受众'] || row['audience'] || row['招聘对象'] || row[`受众(${idx + 1})`] || '',
          salary_range: row['薪资范围'] || row['salary_range'] || row['薪资'] || '',
          job_url: row['JD链接'] || row['job_url'] || row['链接'] || '',
          description: row['描述'] || row['description'] || row['岗位描述'] || '',
          requirements: row['要求'] || row['requirements'] || row['任职要求'] || '',
        })).filter((j: Job) => j.title && j.company && j.region && j.direction && j.audience);

        if (parsedJobs.length > 0) {
          setPreviewJobs(parsedJobs);
          setUploadedFileName(file.name);
          setBatchResult(null);
        } else {
          alert('文件中没有找到有效的岗位数据，请检查表头是否包含：岗位名称、公司名称、地区、方向、受众');
        }
      } else {
        alert('文件中没有找到数据');
      }
    } catch (error) {
      console.error('文件上传失败:', error);
      alert('文件上传失败，请稍后重试');
    }

    // 清空 input
    e.target.value = '';
  };

  // Batch delete handlers
  const toggleJobSelection = (id: number) => {
    const newSelection = new Set(selectedJobIds);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedJobIds(newSelection);
  };

  const toggleSelectAll = () => {
    if (selectedJobIds.size === filteredJobs.length) {
      setSelectedJobIds(new Set());
    } else {
      setSelectedJobIds(new Set(filteredJobs.map(j => j.id)));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedJobIds.size === 0) {
      console.log('No jobs selected');
      return;
    }

    const idsArray = Array.from(selectedJobIds);
    console.log('Starting batch delete for jobs:', idsArray);
    setBatchDeleting(true);
    
    const requestBody = JSON.stringify({ ids: idsArray });
    console.log('Request body:', requestBody);
    
    try {
      const response = await fetch('/api/jobs/batch', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });
      
      console.log('Response status:', response.status);
      const data = await response.json();
      console.log('Response data:', data);

      if (data.success) {
        await fetchJobsPage(jobsPage, jobSearch);
        setSelectedJobIds(new Set());
        setBatchDeleteConfirmOpen(false);
      } else {
        console.error('Delete failed:', data.error);
        alert('删除失败: ' + data.error);
      }
    } catch (error) {
      console.error('Failed to batch delete:', error);
      alert('删除失败，请查看控制台');
    } finally {
      setBatchDeleting(false);
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
        await fetchJobsPage(jobsPage, jobSearch);
        resetJobForm();
        setEditingJob(null);
        setJobDialogOpen(false);
      } else if (!response.ok) {
        alert(data.error || '保存岗位失败');
      }
    } catch (error) {
      console.error('Failed to update job:', error);
      alert('保存岗位失败，请稍后重试');
    }
  };

  const handleDeleteJob = async (id: number) => {
    try {
      const response = await fetch(`/api/jobs/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '删除岗位失败');
      await fetchJobsPage(jobsPage, jobSearch);
      setDeleteJobId(null);
    } catch (error) {
      console.error('Failed to delete job:', error);
      alert(error instanceof Error ? error.message : '删除岗位失败');
    }
  };

  const resetJobForm = () => {
    setJobForm({
      title: '',
      company: '',
      region: configs.region?.[0]?.config_value || '',
      direction: configs.direction?.[0]?.config_value || '',
      audience: configs.audience?.[0]?.config_value || '',
      description: '',
      requirements: '',
      salary_range: '',
      job_url: '',
      logo_url: '',
      is_active: true,
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
      is_active: job.is_active ?? true,
    });
    setJobDialogOpen(true);
  };

  const filteredJobs = [...jobs].sort((a, b) => {
    const aActive = a.is_active !== false;
    const bActive = b.is_active !== false;
    if (aActive !== bActive) return aActive ? -1 : 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <AdminPageShell title="岗位管理" description="编辑、导入和审核岗位内容" permission={ADMIN_PERMISSIONS.jobsRead}>
              <Card>
                <CardHeader className="pb-3 md:pb-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base md:text-lg">岗位管理</CardTitle>
                      <CardDescription className="text-xs md:text-sm">{canWriteJobs ? '添加、编辑和删除岗位信息' : '查看当前可投递岗位信息'}</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="h-8 text-xs md:text-sm" asChild>
                        <Link href="/admin/jobs/sync">
                          <Globe className="h-4 w-4 md:mr-2" />
                          <span className="hidden md:inline">同步运行台</span>
                          <span className="md:hidden">同步</span>
                        </Link>
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 text-xs md:text-sm" asChild>
                        <Link href="/admin/jobs/review">投稿审核</Link>
                      </Button>
                      {canWriteJobs && <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs md:text-sm"
                        onClick={() => {
                          setBatchResult(null);
                          setBatchText('');
                          setBatchImportOpen(true);
                        }}
                      >
                        <Upload className="h-4 w-4 md:mr-2" />
                        <span className="hidden md:inline">批量导入</span>
                        <span className="md:hidden">导入</span>
                      </Button>}
                      {canWriteJobs && <Dialog open={jobDialogOpen} onOpenChange={(open) => {
                        setJobDialogOpen(open);
                        if (!open) {
                          resetJobForm();
                          setEditingJob(null);
                        }
                      }}>
                        <DialogTrigger asChild>
                          <Button size="sm" className="h-8 text-xs md:text-sm">
                            <Plus className="h-4 w-4 md:mr-2" />
                            <span className="hidden md:inline">添加岗位</span>
                            <span className="md:hidden">添加</span>
                          </Button>
                        </DialogTrigger>
                      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle className="text-base md:text-lg">{editingJob ? '编辑岗位' : '添加新岗位'}</DialogTitle>
                          <DialogDescription className="text-xs md:text-sm">
                            填写岗位信息，带 * 的为必填项
                          </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-3 md:gap-4 py-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                            <div>
                              <Label htmlFor="title" className="text-xs md:text-sm">岗位名称 *</Label>
                              <Input
                                id="title"
                                value={jobForm.title}
                                onChange={(e) => setJobForm({ ...jobForm, title: e.target.value })}
                                placeholder="如：Software Engineer"
                                className="h-9 md:h-10"
                              />
                            </div>
                            <div>
                              <Label htmlFor="company" className="text-xs md:text-sm">公司名称 *</Label>
                              <div className="space-y-1">
                                <Input
                                  list="admin-company-options"
                                  value={jobForm.company}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    const company = companies.find(c => c.company_name.toLowerCase() === value.toLowerCase());
                                    setJobForm({
                                      ...jobForm,
                                      company: value,
                                      logo_url: company?.logo_url || jobForm.logo_url,
                                    });
                                  }}
                                  placeholder="输入或选择公司"
                                  className="h-9 md:h-10"
                                />
                                <datalist id="admin-company-options">
                                  {companies.map((company) => (
                                    <option key={company.id} value={company.company_name} />
                                  ))}
                                </datalist>
                                {jobForm.company && (() => {
                                  const matchedCompany = companies.find(c => c.company_name.toLowerCase() === jobForm.company.toLowerCase());
                                  if (matchedCompany) {
                                    return (
                                      <div className="flex items-center gap-2">
                                        <p className="text-xs text-green-600 flex items-center gap-1">
                                          <CheckCircle className="h-3 w-3" />
                                          已关联公司配置
                                        </p>
                                        {matchedCompany.logo_url && (
                                          <>
                                            <span className="text-xs text-muted-foreground">|</span>
                                            <img src={matchedCompany.logo_url} alt="" className="h-4 w-4 rounded" />
                                            <span className="text-xs text-muted-foreground">将自动使用公司Logo</span>
                                          </>
                                        )}
                                      </div>
                                    );
                                  }
                                  return null;
                                })()}
                              </div>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
                            <div>
                              <Label className="text-xs md:text-sm">地区 *</Label>
                              <Select value={jobForm.region} onValueChange={(v) => setJobForm({ ...jobForm, region: v })}>
                                <SelectTrigger className="h-9 md:h-10">
                                  <SelectValue placeholder="选择地区" />
                                </SelectTrigger>
                                <SelectContent>
                                  {configs.region?.map(r => (
                                    <SelectItem key={r.id} value={r.config_value}>{r.config_value}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-xs md:text-sm">方向 *</Label>
                              <Select value={jobForm.direction} onValueChange={(v) => setJobForm({ ...jobForm, direction: v })}>
                                <SelectTrigger className="h-9 md:h-10">
                                  <SelectValue placeholder="选择方向" />
                                </SelectTrigger>
                                <SelectContent>
                                  {configs.direction?.map(d => (
                                    <SelectItem key={d.id} value={d.config_value}>{d.config_value}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-xs md:text-sm">受众 *</Label>
                              <Select value={jobForm.audience} onValueChange={(v) => setJobForm({ ...jobForm, audience: v })}>
                                <SelectTrigger className="h-9 md:h-10">
                                  <SelectValue placeholder="选择受众" />
                                </SelectTrigger>
                                <SelectContent>
                                  {configs.audience?.map(a => (
                                    <SelectItem key={a.id} value={a.config_value}>{a.config_value}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                            <div>
                              <Label htmlFor="salary" className="text-xs md:text-sm">薪资范围</Label>
                              <Input
                                id="salary"
                                value={jobForm.salary_range}
                                onChange={(e) => setJobForm({ ...jobForm, salary_range: e.target.value })}
                                placeholder="如：$120K - $180K"
                                className="h-9 md:h-10"
                              />
                            </div>
                            <div>
                              <Label htmlFor="url" className="text-xs md:text-sm">岗位链接</Label>
                              <Input
                                id="url"
                                value={jobForm.job_url}
                                onChange={(e) => setJobForm({ ...jobForm, job_url: e.target.value })}
                                placeholder="https://careers.xxx.com/..."
                                className="h-9 md:h-10"
                              />
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs md:text-sm">公司Logo</Label>
                            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-start">
                              <div className="flex-1 w-full">
                                <Input
                                  id="logo"
                                  value={jobForm.logo_url}
                                  onChange={(e) => setJobForm({ ...jobForm, logo_url: e.target.value })}
                                  placeholder="输入Logo URL或上传图片"
                                  className="h-9 md:h-10"
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                  支持 PNG、JPG、SVG、WebP 格式，最大 2MB
                                </p>
                              </div>
                              {jobForm.logo_url && (
                                <div className="relative h-12 w-12 overflow-hidden rounded-lg border bg-white">
                                  <img src={jobForm.logo_url} alt="" className="h-full w-full object-contain p-1" />
                                  <button
                                    type="button"
                                    onClick={() => setJobForm({ ...jobForm, logo_url: '' })}
                                    className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-xs text-destructive-foreground"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                              )}
                            </div>
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
                          <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
                            <div>
                              <Label className="text-base font-medium">可投递状态</Label>
                              <p className="text-sm text-muted-foreground">开启后，该岗位将在岗位列表中显示为&quot;可投递&quot;状态</p>
                            </div>
                            <Switch
                              checked={jobForm.is_active}
                              onCheckedChange={(checked) => setJobForm({ ...jobForm, is_active: checked })}
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
                    </Dialog>}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {/* Search and Batch Actions */}
                  <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="搜索岗位名称或公司..."
                        value={jobSearch}
                        onChange={(e) => {
                          setJobSearch(e.target.value);
                          setJobsPage(0);
                        }}
                        className="pl-10 h-9 md:h-10"
                      />
                    </div>
                    {canWriteJobs && selectedJobIds.size > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="secondary" className="px-3 py-1 text-xs">
                          已选择 {selectedJobIds.size} 项
                        </Badge>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => setBatchDeleteConfirmOpen(true)}
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          批量删除
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => setSelectedJobIds(new Set())}
                        >
                          取消
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900/40">
                    <Link href="/admin/jobs/sync" className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">岗位同步与近 24 小时变更</Link>
                    <span className="text-muted-foreground"> 已单独放到同步页，避免和岗位编辑混在一起。</span>
                  </div>

                  {jobsError && (
                    <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      <span>{jobsError}</span>
                      <Button type="button" size="sm" variant="outline" onClick={() => void fetchJobsPage()}>
                        重试
                      </Button>
                    </div>
                  )}

                  {/* Jobs Table - 手机端隐藏部分列 */}
                  <div className="border rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[900px]">
                        <thead className="bg-muted/50">
                          <tr>
                            {canWriteJobs && <th className="px-3 md:px-4 py-2 md:py-3 w-10 md:w-12">
                              <input
                                type="checkbox"
                                checked={filteredJobs.length > 0 && selectedJobIds.size === filteredJobs.length}
                                onChange={toggleSelectAll}
                                className="h-4 w-4 rounded border-gray-300"
                              />
                            </th>}
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium">岗位</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium">公司</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium hidden md:table-cell">地区</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium hidden md:table-cell">方向</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium hidden lg:table-cell whitespace-nowrap">受众</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium hidden lg:table-cell whitespace-nowrap">薪资</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium whitespace-nowrap">状态</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-right text-xs md:text-sm font-medium whitespace-nowrap">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {jobsLoading ? (
                            <tr key="jobs-loading">
                              <td colSpan={9} className="py-10 text-center text-muted-foreground">
                                <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                                正在加载岗位…
                              </td>
                            </tr>
                          ) : filteredJobs.map((job) => (
                            <tr key={job.id} className={`hover:bg-muted/30 ${selectedJobIds.has(job.id) ? 'bg-primary/5' : ''}`}>
                              <td className="px-3 md:px-4 py-2 md:py-3">
                                <input
                                  type="checkbox"
                                  checked={selectedJobIds.has(job.id)}
                                  onChange={() => toggleJobSelection(job.id)}
                                  className="h-4 w-4 rounded border-gray-300"
                                />
                              </td>
                              <td className="px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm font-medium">{job.title}</td>
                              <td className="px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm">{job.company}</td>
                              <td className="px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm hidden md:table-cell">
                                <Badge variant="outline" className="text-xs">{job.region}</Badge>
                              </td>
                              <td className="px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm hidden md:table-cell">{job.direction}</td>
                              <td className="px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm hidden lg:table-cell whitespace-nowrap">{job.audience}</td>
                              <td className="px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm text-green-600 hidden lg:table-cell whitespace-nowrap">{job.salary_range || '-'}</td>
                              <td className="px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm whitespace-nowrap">
                                {job.is_active === false ? (
                                  <Badge variant="secondary" className="bg-gray-100 text-gray-600 text-xs">不可投递</Badge>
                                ) : (
                                  <Badge variant="default" className="bg-green-600 text-xs">可投递</Badge>
                                )}
                              </td>
                              <td className="px-3 md:px-4 py-2 md:py-3 text-right">
                                <div className="flex justify-end gap-1 md:gap-2">
                                  {job.job_url && (
                                    <Button size="sm" variant="ghost" asChild>
                                      <a href={job.job_url} target="_blank" rel="noopener noreferrer">
                                        <ExternalLink className="h-4 w-4" />
                                      </a>
                                    </Button>
                                  )}
                                  {canWriteJobs && <Button size="sm" variant="ghost" onClick={() => openEditJob(job)}>
                                    <Edit className="h-4 w-4" />
                                  </Button>}
                                  {canWriteJobs && <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive"
                                    onClick={() => setDeleteJobId(job.id)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>}
                                </div>
                              </td>
                            </tr>
                          ))} 
                        </tbody>
                      </table>
                    </div>
                    {!jobsLoading && filteredJobs.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">
                        暂无岗位数据
                      </div>
                    )}
                  </div>
                  {jobsTotal > 0 && (
                    <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>共 {jobsTotal} 个可投递岗位，第 {jobsPage + 1} 页，每页 {jobsPageSize} 条</span>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setJobsPage((current) => Math.max(0, current - 1))}
                          disabled={jobsPage === 0}
                        >
                          <ChevronLeft className="h-4 w-4 mr-1" />上一页
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setJobsPage((current) => current + 1)}
                          disabled={(jobsPage + 1) * jobsPageSize >= jobsTotal}
                        >
                          下一页<ChevronRight className="h-4 w-4 ml-1" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
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
      {/* Batch Delete Confirmation */}
      <Dialog open={batchDeleteConfirmOpen} onOpenChange={setBatchDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认批量删除</DialogTitle>
            <DialogDescription>
              此操作将永久删除选中的 {selectedJobIds.size} 个岗位，删除后无法恢复。确定要继续吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setBatchDeleteConfirmOpen(false)}
              disabled={batchDeleting}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleBatchDelete}
              disabled={batchDeleting}
            >
              {batchDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  删除中...
                </>
              ) : (
                `删除 ${selectedJobIds.size} 个岗位`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Import Dialog */}
      <Dialog open={batchImportOpen} onOpenChange={setBatchImportOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>批量导入岗位</DialogTitle>
            <DialogDescription>
                支持 Excel (.xlsx) 或 CSV 文件上传，也可使用文本方式导入
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* 模式切换 */}
            <div className="flex gap-2 border-b pb-2">
              <Button
                variant={importMode === 'file' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setImportMode('file')}
              >
                <FileSpreadsheet className="h-4 w-4 mr-1" />
                表格上传
              </Button>
              <Button
                variant={importMode === 'text' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setImportMode('text')}
              >
                <FileText className="h-4 w-4 mr-1" />
                文本导入
              </Button>
            </div>

            {/* 表格上传模式 */}
            {importMode === 'file' && (
              <div className="space-y-4">
                {/* 下载模板提示 */}
                <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="h-5 w-5 text-blue-600" />
                    <span className="text-sm text-blue-800">
                      首次导入？下载模板快速开始
                    </span>
                  </div>
                  <a
                    href="/岗位导入模板.xlsx"
                    download="岗位导入模板.xlsx"
                    className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    <Download className="h-4 w-4" />
                    下载模板
                  </a>
                </div>

                {/* 文件上传区域 */}
                <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center hover:border-primary/50 transition-colors">
                  <input
                    type="file"
                    accept=".xlsx,.csv"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="batch-file-upload"
                    disabled={batchImporting}
                  />
                  <label htmlFor="batch-file-upload" className="cursor-pointer">
                    <Upload className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mb-1">
                      点击选择文件或拖拽文件到此处
                    </p>
                    <p className="text-xs text-muted-foreground">
                      支持 .xlsx, .csv 格式
                    </p>
                  </label>
                </div>

                {/* 已上传文件信息 */}
                {uploadedFileName && (
                  <div className="bg-muted/50 rounded-lg p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="h-5 w-5 text-green-600" />
                      <span className="text-sm font-medium">{uploadedFileName}</span>
                      <Badge variant="secondary">{previewJobs.length} 条</Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setPreviewJobs([]); setUploadedFileName(''); }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}

                {/* 预览表格 */}
                {previewJobs.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="max-h-[300px] overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">岗位名称</th>
                            <th className="px-3 py-2 text-left font-medium">公司</th>
                            <th className="px-3 py-2 text-left font-medium">地区</th>
                            <th className="px-3 py-2 text-left font-medium">方向</th>
                            <th className="px-3 py-2 text-left font-medium">受众</th>
                            <th className="px-3 py-2 text-left font-medium">薪资</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {previewJobs.slice(0, 50).map((job, idx) => (
                            <tr key={idx} className="hover:bg-muted/50">
                              <td className="px-3 py-2">{job.title}</td>
                              <td className="px-3 py-2">{job.company}</td>
                              <td className="px-3 py-2">{job.region}</td>
                              <td className="px-3 py-2">{job.direction}</td>
                              <td className="px-3 py-2">{job.audience}</td>
                              <td className="px-3 py-2 text-muted-foreground">{job.salary_range || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {previewJobs.length > 50 && (
                      <div className="bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                        还有 {previewJobs.length - 50} 条数据未显示
                      </div>
                    )}
                  </div>
                )}

                {/* 表头说明 */}
                <div className="bg-muted/50 rounded-lg p-4 text-sm">
                  <p className="font-medium mb-2">Excel/CSV 表头要求：</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                    <div><span className="font-medium">岗位名称</span>（必填）</div>
                    <div><span className="font-medium">公司名称</span>（必填）</div>
                    <div><span className="font-medium">地区</span>（必填）</div>
                    <div><span className="font-medium">方向</span>（必填）</div>
                    <div><span className="font-medium">受众</span>（必填）</div>
                    <div><span className="font-medium">薪资范围</span>（可选）</div>
                    <div><span className="font-medium">JD链接</span>（可选）</div>
                    <div><span className="font-medium">描述</span>（可选）</div>
                  </div>
                </div>
              </div>
            )}

            {/* 文本导入模式 */}
            {importMode === 'text' && (
              <div className="space-y-4">
                <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
                  <p className="font-medium">格式说明：</p>
                  <code className="block bg-background p-2 rounded text-xs overflow-x-auto">
                    岗位名称 | 公司名称 | 地区 | 方向 | 受众 | 薪资范围 | JD链接
                  </code>
                  <p className="text-muted-foreground">前5项为必填，后2项可选</p>
                  <div className="border-t pt-2 mt-2">
                    <p className="font-medium mb-1">示例：</p>
                    <code className="block bg-background p-2 rounded text-xs overflow-x-auto">
                      Software Engineer | Google | 美国 | SDE | 应届生 | 15-25万 | https://careers.google.com/xxx
                    </code>
                  </div>
                </div>

                <div>
                  <Label>岗位数据</Label>
                  <Textarea
                    value={batchText}
                    onChange={(e) => setBatchText(e.target.value)}
                    placeholder="粘贴岗位数据，每行一个岗位..."
                    className="min-h-[200px] font-mono text-sm"
                    disabled={batchImporting}
                  />
                </div>
              </div>
            )}

            {/* 结果显示 */}
            {batchResult && (
              <div className={`rounded-lg p-4 ${batchResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                <div className="flex items-center gap-2 mb-2">
                  {batchResult.success ? (
                    <CheckCircle className="h-5 w-5 text-green-600" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-600" />
                  )}
                  <span className={`font-medium ${batchResult.success ? 'text-green-800' : 'text-red-800'}`}>
                    导入{batchResult.success ? '成功' : '失败'}
                  </span>
                </div>
                <div className={`text-sm ${batchResult.success ? 'text-green-700' : 'text-red-700'}`}>
                  <p>成功导入：{batchResult.created} 条</p>
                  {batchResult.skipped && batchResult.skipped > 0 && (
                    <p>跳过（重复）：{batchResult.skipped} 条</p>
                  )}
                  {batchResult.total && (
                    <p>总计处理：{batchResult.total} 条</p>
                  )}
                  {batchResult.invalidCount && batchResult.invalidCount > 0 && (
                    <p>失败：{batchResult.invalidCount} 条</p>
                  )}
                </div>
                {batchResult.invalidJobs && batchResult.invalidJobs.length > 0 && (
                  <div className="mt-3 text-sm">
                    <p className="font-medium text-red-800 mb-1">失败详情：</p>
                    <div className="space-y-1 max-h-[150px] overflow-y-auto">
                      {batchResult.invalidJobs.map((job, idx) => (
                        <div key={idx} className="bg-white/50 p-2 rounded text-xs">
                          <span className="text-red-600">第{job.index}行：</span>
                          <span className="text-red-500">{job.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetBatchImport} disabled={batchImporting}>
              {batchResult?.success ? '关闭' : '取消'}
            </Button>
            {!batchResult?.success && (
              <Button 
                onClick={handleBatchImport} 
                disabled={batchImporting || (importMode === 'file' ? previewJobs.length === 0 : !batchText.trim())}
              >
                {batchImporting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    导入中...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    开始导入 ({importMode === 'file' ? previewJobs.length : '文本'})
                  </>
                )}
              </Button>
            )}
            {batchResult?.success && batchResult.created && batchResult.created > 0 && (
              <Button onClick={resetBatchImport}>
                继续导入
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPageShell>
  );
}
