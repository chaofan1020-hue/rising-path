'use client';

import { useState, useEffect, useRef } from 'react';
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
import { Switch } from '@/components/ui/switch';
import { AdminAuthGuard } from '@/components/admin-auth-guard';
import { LogoUploadDialog } from '@/components/logo-upload-dialog';
import Image from 'next/image';
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
  Settings,
  Upload,
  X,
  BarChart3,
  TrendingUp,
  Activity,
  ImageIcon,
  Wand2,
  PieChart,
  RefreshCw,
  Building2,
  Pencil,
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
  is_active?: boolean;
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

interface JobConfig {
  id: number;
  config_type: string;
  config_value: string;
  sort_order: number;
  is_active: boolean;
}

// Analytics types
interface AnalyticsData {
  overview: {
    totalAccessCodes: number;
    activeAccessCodes: number;
    expiredAccessCodes: number;
    totalResumes: number;
    recentResumes: number;
    totalJobs: number;
    recentJobs: number;
    totalApplications: number;
    recentApplications: number;
    totalAiMatches: number;
    recentAiMatches: number;
  };
  charts: {
    jobsByRegion: Record<string, number>;
    jobsByDirection: Record<string, number>;
    applicationsByStatus: Record<string, number>;
    dailyStats: { date: string; resumes: number; applications: number; aiMatches: number }[];
    // 用户画像统计
    resumesByRegion: Record<string, number>;
    resumesBySchool: Record<string, number>;
    resumesByDegree: Record<string, number>;
  };
  userActivity: { accessCodeId: number; accessCodeName: string; resumes: number; applications: number; aiMatches: number }[];
}

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
  
  // Analytics state
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsRange, setAnalyticsRange] = useState<'7d' | '30d' | '90d' | 'all'>('7d');

  // Config state
  const [configs, setConfigs] = useState<Record<string, JobConfig[]>>({
    region: [],
    direction: [],
    audience: [],
  });
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [configForm, setConfigForm] = useState({ type: 'region', value: '' });
  const [editingConfig, setEditingConfig] = useState<JobConfig | null>(null);

  // Company config state
  interface CompanyConfig {
    id: number;
    company_name: string;
    careers_url: string;
    ats_type: string;
    ats_id: string;
    logo_url: string;
  }
  const [companies, setCompanies] = useState<CompanyConfig[]>([]);
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);
  const [companyForm, setCompanyForm] = useState({
    company_name: '',
    careers_url: '',
    ats_type: 'manual',
    ats_id: '',
    logo_url: '',
  });
  const [editingCompany, setEditingCompany] = useState<CompanyConfig | null>(null);

  // Access codes state
  interface AccessCode {
    id: number;
    code: string;
    name: string;
    duration_days: number;
    expires_at: string;
    is_active: boolean;
    created_at: string;
    last_used_at: string | null;
  }
  const [accessCodes, setAccessCodes] = useState<AccessCode[]>([]);

  // Company logos state
  const [companyLogos, setCompanyLogos] = useState<{ id: number; company_name: string; logo_url: string }[]>([]);
  const [logoDialogOpen, setLogoDialogOpen] = useState(false);
  const [logoForm, setLogoForm] = useState({ company_name: '', logo: null as File | null });
  const [logoUploading, setLogoUploading] = useState(false);

  // Job sync state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: number; message: string } | null>(null);
  const [fetchingFromUrl, setFetchingFromUrl] = useState(false);

  // Change password
  const handleChangePassword = async () => {
    setPasswordError('');
    setPasswordSuccess('');

    if (!oldPassword || !newPassword || !confirmPassword) {
      setPasswordError('请填写所有字段');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('新密码至少6位');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的新密码不一致');
      return;
    }

    setPasswordSaving(true);
    try {
      const response = await fetch('/api/admin/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword, newPassword }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setPasswordSuccess('密码修改成功！');
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setTimeout(() => {
          setPasswordDialogOpen(false);
          setPasswordSuccess('');
        }, 1500);
      } else {
        setPasswordError(data.error || '修改失败');
      }
    } catch {
      setPasswordError('修改失败，请稍后重试');
    } finally {
      setPasswordSaving(false);
    }
  };

  // 从 URL 智能填充岗位信息
  const handleFetchFromUrl = async () => {
    if (!jobForm.job_url) {
      alert('请先输入岗位链接');
      return;
    }
    
    setFetchingFromUrl(true);
    try {
      const response = await fetch('/api/admin/fetch-job-from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: jobForm.job_url }),
      });
      
      const data = await response.json();
      
      if (data.success && data.data) {
        setJobForm(prev => ({
          ...prev,
          title: data.data.title || prev.title,
          company: data.data.company || prev.company,
          region: data.data.region || prev.region,
          description: data.data.description || prev.description,
        }));
        alert('成功提取岗位信息！请检查并补充其他字段。');
      } else {
        alert(data.error || '提取失败，请手动填写');
      }
    } catch {
      alert('提取失败，请手动填写');
    } finally {
      setFetchingFromUrl(false);
    }
  };

  // Fetch company logos
  const fetchLogos = async () => {
    try {
      const response = await fetch('/api/admin/company-logos');
      const data = await response.json();
      if (data.logos) {
        setCompanyLogos(data.logos);
      }
    } catch (error) {
      console.error('Error fetching logos:', error);
    }
  };

  // Handle logo upload
  const handleLogoUpload = async () => {
    if (!logoForm.company_name || !logoForm.logo) {
      alert('请填写公司名称并选择 logo 文件');
      return;
    }

    setLogoUploading(true);
    try {
      const formData = new FormData();
      formData.append('company_name', logoForm.company_name);
      formData.append('logo', logoForm.logo);

      const response = await fetch('/api/admin/company-logos', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        alert('Logo 上传成功！');
        setLogoDialogOpen(false);
        setLogoForm({ company_name: '', logo: null });
        fetchLogos();
      } else {
        alert(data.error || '上传失败');
      }
    } catch (error) {
      alert('上传失败');
    } finally {
      setLogoUploading(false);
    }
  };

  // Handle logo delete
  const handleLogoDelete = async (companyName: string) => {
    if (!confirm(`确定删除 ${companyName} 的 logo？`)) return;

    try {
      const response = await fetch(`/api/admin/company-logos?company_name=${encodeURIComponent(companyName)}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      if (data.success) {
        alert('删除成功');
        fetchLogos();
      } else {
        alert(data.error || '删除失败');
      }
    } catch (error) {
      alert('删除失败');
    }
  };

  // Logo upload state
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Job form state
  const [jobForm, setJobForm] = useState({
    title: '',
    company: '',
    region: '',
    direction: '',
    audience: '',
    description: '',
    requirements: '',
    salary_range: '',
    job_url: '',
    logo_url: '',
    is_active: true,
  });
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [deleteJobId, setDeleteJobId] = useState<number | null>(null);

  // Application form state
  const [editingApp, setEditingApp] = useState<Application | null>(null);
  const [appDialogOpen, setAppDialogOpen] = useState(false);

  // Search state
  const [jobSearch, setJobSearch] = useState('');

  // Batch import state
  const [batchImportOpen, setBatchImportOpen] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [batchImporting, setBatchImporting] = useState(false);
  const [batchResult, setBatchResult] = useState<{
    success?: boolean;
    created?: number;
    total?: number;
    invalidCount?: number;
    invalidJobs?: { index: number; reason: string; data: Record<string, unknown> }[];
  } | null>(null);

  // Batch delete state
  const [selectedJobIds, setSelectedJobIds] = useState<Set<number>>(new Set());
  const [batchDeleteConfirmOpen, setBatchDeleteConfirmOpen] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);

  // Password change state
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [jobsRes, resumesRes, appsRes, configsRes, accessCodesRes, companiesRes] = await Promise.all([
        fetch('/api/jobs'),
        fetch('/api/resume'),
        fetch('/api/applications'),
        fetch('/api/configs'),
        fetch('/api/access-codes'),
        fetch('/api/admin/company-config'),
      ]);
      const jobsData = await jobsRes.json();
      const resumesData = await resumesRes.json();
      const appsData = await appsRes.json();
      const configsData = await configsRes.json();
      const accessCodesData = await accessCodesRes.json();
      const companiesData = await companiesRes.json();
      setJobs(jobsData.jobs || []);
      setResumes(resumesData.resumes || []);
      setApplications(appsData.applications || []);
      setConfigs(configsData.configs || {});
      setAccessCodes(accessCodesData.codes || []);
      setCompanies(companiesData.companies || []);
      
      // Set default form values from configs
      if (configsData.configs?.region?.[0]) {
        setJobForm(prev => ({ ...prev, region: configsData.configs.region[0].config_value }));
      }
      if (configsData.configs?.direction?.[0]) {
        setJobForm(prev => ({ ...prev, direction: configsData.configs.direction[0].config_value }));
      }
      if (configsData.configs?.audience?.[0]) {
        setJobForm(prev => ({ ...prev, audience: configsData.configs.audience[0].config_value }));
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch analytics data
  const fetchAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const response = await fetch(`/api/analytics?range=${analyticsRange}`);
      const data = await response.json();
      setAnalytics(data);
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
    fetchLogos();
  }, [analyticsRange]);


  // Config CRUD
  const handleCreateConfig = async () => {
    if (!configForm.value.trim()) return;
    
    try {
      const response = await fetch('/api/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config_type: configForm.type,
          config_value: configForm.value.trim(),
        }),
      });
      const data = await response.json();
      if (data.config) {
        setConfigs(prev => ({
          ...prev,
          [configForm.type]: [...(prev[configForm.type] || []), data.config],
        }));
        setConfigForm({ type: configForm.type, value: '' });
        setConfigDialogOpen(false);
      }
    } catch (error) {
      console.error('Failed to create config:', error);
    }
  };

  const handleDeleteConfig = async (id: number, type: string) => {
    try {
      await fetch(`/api/configs?id=${id}`, { method: 'DELETE' });
      setConfigs(prev => ({
        ...prev,
        [type]: prev[type].filter(c => c.id !== id),
      }));
    } catch (error) {
      console.error('Failed to delete config:', error);
    }
  };

  // Company Config CRUD
  const handleSaveCompany = async () => {
    if (!companyForm.company_name) {
      alert('请输入公司名称');
      return;
    }
    try {
      const response = await fetch('/api/admin/company-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(companyForm),
      });
      const data = await response.json();
      if (data.success) {
        setCompanyDialogOpen(false);
        // Refresh company list
        const res = await fetch('/api/admin/company-config');
        const data = await res.json();
        setCompanies(data.companies || []);
        setCompanyForm({ company_name: '', careers_url: '', ats_type: 'manual', ats_id: '', logo_url: '' });
        setEditingCompany(null);
      } else {
        alert(data.error || '保存失败');
      }
    } catch (error) {
      console.error('Failed to save company:', error);
      alert('保存失败');
    }
  };

  const handleEditCompany = (company: CompanyConfig) => {
    setEditingCompany(company);
    setCompanyForm({
      company_name: company.company_name,
      careers_url: company.careers_url || '',
      ats_type: company.ats_type || 'manual',
      ats_id: company.ats_id || '',
      logo_url: company.logo_url || '',
    });
    setCompanyDialogOpen(true);
  };

  const handleDeleteCompany = async (id: number) => {
    if (!confirm('确定要删除这家企业吗？')) return;
    try {
      await fetch(`/api/admin/company-config?id=${id}`, { method: 'DELETE' });
      setCompanies(prev => prev.filter(c => c.id !== id));
    } catch (error) {
      console.error('Failed to delete company:', error);
    }
  };

  // Access Code CRUD
  const handleCreateAccessCode = async () => {
    const name = prompt('请输入访问码名称（可选）', '');
    if (name === null) return; // 用户取消
    
    const durationInput = prompt('请输入有效天数（默认30天）', '30');
    if (durationInput === null) return; // 用户取消
    
    const duration_days = parseInt(durationInput) || 30;
    
    try {
      const response = await fetch('/api/access-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || undefined, duration_days }),
      });
      const data = await response.json();
      if (data.code) {
        setAccessCodes([data.code, ...accessCodes]);
        alert(`访问码创建成功：${data.code.code}\n有效期：${duration_days}天`);
      }
    } catch (error) {
      console.error('Failed to create access code:', error);
      alert('创建访问码失败');
    }
  };

  const handleToggleAccessCode = async (id: number, currentActive: boolean) => {
    try {
      const response = await fetch(`/api/access-codes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !currentActive }),
      });
      const data = await response.json();
      if (data.success) {
        setAccessCodes(accessCodes.map(c => 
          c.id === id ? { ...c, is_active: !currentActive } : c
        ));
      }
    } catch (error) {
      console.error('Failed to toggle access code:', error);
    }
  };

  const handleDeleteAccessCode = async (id: number) => {
    if (!confirm('确定要删除此访问码吗？')) return;
    
    try {
      const response = await fetch(`/api/access-codes?id=${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (data.success) {
        setAccessCodes(accessCodes.filter(c => c.id !== id));
      }
    } catch (error) {
      console.error('Failed to delete access code:', error);
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
    const jobsToImport = parseBatchText(batchText);
    
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
        total: data.total,
        invalidCount: data.invalidCount,
        invalidJobs: data.invalidJobs
      });

      if (data.success && data.created > 0) {
        // 刷新岗位列表
        const jobsRes = await fetch('/api/jobs');
        const jobsData = await jobsRes.json();
        setJobs(jobsData.jobs || []);
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
    setBatchImportOpen(false);
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
        setJobs(jobs.filter(j => !selectedJobIds.has(j.id)));
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

  const filteredJobs = jobs
    .filter(
      job => 
        job.title.toLowerCase().includes(jobSearch.toLowerCase()) ||
        job.company.toLowerCase().includes(jobSearch.toLowerCase())
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
    <AdminAuthGuard>
      <div className="min-h-screen bg-muted/30">
        {/* Header */}
        <header className="border-b bg-background sticky top-0 z-50">
          <div className="container mx-auto px-4 h-14 md:h-16 flex items-center justify-between">
            <div className="flex items-center gap-2 md:gap-3">
              <LayoutDashboard className="h-5 w-5 md:h-6 md:w-6 text-primary" />
              <span className="font-bold text-lg md:text-xl">管理后台</span>
            </div>
            <div className="flex items-center gap-1 md:gap-2">
              <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 md:w-auto md:px-3">
                    <Settings className="h-4 w-4 md:mr-1" />
                    <span className="hidden md:inline">修改密码</span>
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>修改管理密码</DialogTitle>
                    <DialogDescription>
                      请输入原密码和新密码
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div>
                      <Label>原密码</Label>
                      <Input
                        type="password"
                        value={oldPassword}
                        onChange={(e) => setOldPassword(e.target.value)}
                        placeholder="请输入原密码"
                      />
                    </div>
                    <div>
                      <Label>新密码</Label>
                      <Input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="请输入新密码（至少6位）"
                      />
                    </div>
                    <div>
                      <Label>确认新密码</Label>
                      <Input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="请再次输入新密码"
                      />
                    </div>
                    {passwordError && (
                      <p className="text-sm text-red-500">{passwordError}</p>
                    )}
                    {passwordSuccess && (
                      <p className="text-sm text-green-500">{passwordSuccess}</p>
                    )}
                  </div>
                  <DialogFooter>
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        setPasswordDialogOpen(false);
                        setOldPassword('');
                        setNewPassword('');
                        setConfirmPassword('');
                        setPasswordError('');
                        setPasswordSuccess('');
                      }}
                    >
                      取消
                    </Button>
                    <Button 
                      onClick={handleChangePassword}
                      disabled={passwordSaving}
                    >
                      {passwordSaving ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          保存中...
                        </>
                      ) : (
                        '保存'
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Link href="/">
                <Button variant="outline" size="sm" className="h-8 w-8 md:w-auto md:px-3">
                  <ExternalLink className="h-4 w-4 md:mr-1" />
                  <span className="hidden md:inline">返回首页</span>
                </Button>
              </Link>
              <Button 
                variant="ghost" 
                size="sm"
                className="h-8 w-8 md:w-auto md:px-3"
                onClick={() => {
                  localStorage.removeItem('admin_auth');
                  window.location.reload();
                }}
              >
                <LogOut className="h-4 w-4 md:mr-1" />
                <span className="hidden md:inline">退出</span>
              </Button>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-4 md:py-8">
        {loading ? (
          <div className="text-center py-12">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="mt-2 text-muted-foreground">加载中...</p>
          </div>
        ) : (
          <Tabs defaultValue="overview" className="space-y-4 md:space-y-6">
            <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
              <TabsList className="grid w-max md:w-full grid-cols-8 gap-1 md:gap-0 md:inline-flex">
                <TabsTrigger value="overview" className="px-3 md:px-4">
                  <LayoutDashboard className="h-4 w-4 md:mr-2" />
                  <span className="hidden md:inline">概览</span>
                </TabsTrigger>
                <TabsTrigger value="analytics" className="px-3 md:px-4">
                  <BarChart3 className="h-4 w-4 md:mr-2" />
                  <span className="hidden md:inline">数据分析</span>
                </TabsTrigger>
                <TabsTrigger value="jobs" className="px-3 md:px-4">
                  <Briefcase className="h-4 w-4 md:mr-2" />
                  <span className="hidden md:inline">岗位管理</span>
                </TabsTrigger>
                <TabsTrigger value="logos" className="px-3 md:px-4">
                  <ImageIcon className="h-4 w-4 md:mr-2" />
                  <span className="hidden md:inline">Logo</span>
                </TabsTrigger>
                <TabsTrigger value="resumes" className="px-3 md:px-4">
                  <FileText className="h-4 w-4 md:mr-2" />
                  <span className="hidden md:inline">简历管理</span>
                </TabsTrigger>
                <TabsTrigger value="applications" className="px-3 md:px-4">
                  <Send className="h-4 w-4 md:mr-2" />
                  <span className="hidden md:inline">网申管理</span>
                </TabsTrigger>
                <TabsTrigger value="access-codes" className="px-3 md:px-4">
                  <Users className="h-4 w-4 md:mr-2" />
                  <span className="hidden md:inline">访问码</span>
                </TabsTrigger>
                <TabsTrigger value="configs" className="px-3 md:px-4">
                  <Settings className="h-4 w-4 md:mr-2" />
                  <span className="hidden md:inline">配置管理</span>
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Overview Tab */}
            <TabsContent value="overview">
              <div className="grid gap-4 md:gap-6">
                {/* Stats Cards - 手机端横向滚动 */}
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 md:grid md:grid-cols-4 lg:grid-cols-7 md:gap-4 md:overflow-visible">
                  <Card className="flex-shrink-0 w-28 md:w-auto">
                    <CardContent className="pt-4 md:pt-6 pb-3 md:pb-6 text-center">
                      <div className="flex items-center justify-center gap-1 md:gap-2">
                        <Briefcase className="h-4 w-4 md:h-5 md:w-5 text-blue-600" />
                        <span className="text-xl md:text-2xl font-bold">{stats.totalJobs}</span>
                      </div>
                      <p className="text-xs md:text-sm text-muted-foreground mt-1">岗位总数</p>
                    </CardContent>
                  </Card>
                  <Card className="flex-shrink-0 w-28 md:w-auto">
                    <CardContent className="pt-4 md:pt-6 pb-3 md:pb-6 text-center">
                      <div className="flex items-center justify-center gap-1 md:gap-2">
                        <FileText className="h-4 w-4 md:h-5 md:w-5 text-green-600" />
                        <span className="text-xl md:text-2xl font-bold">{stats.totalResumes}</span>
                      </div>
                      <p className="text-xs md:text-sm text-muted-foreground mt-1">简历总数</p>
                    </CardContent>
                  </Card>
                  <Card className="flex-shrink-0 w-28 md:w-auto">
                    <CardContent className="pt-4 md:pt-6 pb-3 md:pb-6 text-center">
                      <div className="flex items-center justify-center gap-1 md:gap-2">
                        <Send className="h-4 w-4 md:h-5 md:w-5 text-purple-600" />
                        <span className="text-xl md:text-2xl font-bold">{stats.totalApplications}</span>
                      </div>
                      <p className="text-xs md:text-sm text-muted-foreground mt-1">网申总数</p>
                    </CardContent>
                  </Card>
                  <Card className="flex-shrink-0 w-28 md:w-auto">
                    <CardContent className="pt-4 md:pt-6 pb-3 md:pb-6 text-center">
                      <div className="flex items-center justify-center gap-1 md:gap-2">
                        <Clock className="h-4 w-4 md:h-5 md:w-5 text-yellow-600" />
                        <span className="text-xl md:text-2xl font-bold">{stats.pendingApps}</span>
                      </div>
                      <p className="text-xs md:text-sm text-muted-foreground mt-1">待投递</p>
                    </CardContent>
                  </Card>
                  <Card className="flex-shrink-0 w-28 md:w-auto">
                    <CardContent className="pt-4 md:pt-6 pb-3 md:pb-6 text-center">
                      <div className="flex items-center justify-center gap-1 md:gap-2">
                        <CheckCircle className="h-4 w-4 md:h-5 md:w-5 text-blue-600" />
                        <span className="text-xl md:text-2xl font-bold">{stats.submittedApps}</span>
                      </div>
                      <p className="text-xs md:text-sm text-muted-foreground mt-1">已投递</p>
                    </CardContent>
                  </Card>
                  <Card className="flex-shrink-0 w-28 md:w-auto">
                    <CardContent className="pt-4 md:pt-6 pb-3 md:pb-6 text-center">
                      <div className="flex items-center justify-center gap-1 md:gap-2">
                        <Calendar className="h-4 w-4 md:h-5 md:w-5 text-purple-600" />
                        <span className="text-xl md:text-2xl font-bold">{stats.interviewApps}</span>
                      </div>
                      <p className="text-xs md:text-sm text-muted-foreground mt-1">面试中</p>
                    </CardContent>
                  </Card>
                  <Card className="flex-shrink-0 w-28 md:w-auto">
                    <CardContent className="pt-4 md:pt-6 pb-3 md:pb-6 text-center">
                      <div className="flex items-center justify-center gap-1 md:gap-2">
                        <CheckCircle className="h-4 w-4 md:h-5 md:w-5 text-green-600" />
                        <span className="text-xl md:text-2xl font-bold">{stats.offerApps}</span>
                      </div>
                      <p className="text-xs md:text-sm text-muted-foreground mt-1">已录用</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Quick Actions */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">岗位分布</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {configs.region?.map(config => {
                          const count = jobs.filter(j => j.region === config.config_value).length;
                          return (
                            <div key={config.id} className="flex items-center justify-between">
                              <span className="text-sm">{config.config_value}</span>
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
                        {configs.direction?.map(config => {
                          const count = jobs.filter(j => j.direction === config.config_value).length;
                          return (
                            <div key={config.id} className="flex items-center justify-between">
                              <span className="text-sm">{config.config_value}</span>
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
                        {configs.audience?.map(config => {
                          const count = jobs.filter(j => j.audience === config.config_value).length;
                          return (
                            <div key={config.id} className="flex items-center justify-between">
                              <span className="text-sm">{config.config_value}</span>
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

            {/* Analytics Tab */}
            <TabsContent value="analytics">
              <div className="space-y-6">
                {/* Time Range Selector */}
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  <span className="text-sm text-muted-foreground flex-shrink-0">时间范围：</span>
                  <div className="flex gap-1">
                    {(['7d', '30d', '90d', 'all'] as const).map((range) => (
                      <Button
                        key={range}
                        variant={analyticsRange === range ? 'default' : 'outline'}
                        size="sm"
                        className="h-8 px-2 md:px-3 text-xs"
                        onClick={() => setAnalyticsRange(range)}
                      >
                        {range === '7d' ? '近7天' : range === '30d' ? '近30天' : range === '90d' ? '近90天' : '全部'}
                      </Button>
                    ))}
                  </div>
                </div>

                {analyticsLoading ? (
                  <div className="text-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                    <p className="mt-2 text-muted-foreground">加载分析数据...</p>
                  </div>
                ) : analytics ? (
                  <>
                    {/* Overview Stats */}
                    <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 md:grid md:grid-cols-4 lg:grid-cols-6 md:gap-4 md:overflow-visible">
                      <Card className="flex-shrink-0 w-32 md:w-auto">
                        <CardContent className="pt-4 md:pt-6 pb-3 md:pb-6">
                          <div className="flex items-center gap-1 md:gap-2">
                            <Users className="h-4 w-4 md:h-5 md:w-5 text-blue-600" />
                            <div>
                              <span className="text-lg md:text-2xl font-bold">{analytics.overview.activeAccessCodes}</span>
                              <span className="text-xs md:text-sm text-muted-foreground">/{analytics.overview.totalAccessCodes}</span>
                            </div>
                          </div>
                          <p className="text-xs md:text-sm text-muted-foreground mt-1">活跃/总访问码</p>
                        </CardContent>
                      </Card>
                      <Card className="flex-shrink-0 w-32 md:w-auto">
                        <CardContent className="pt-4 md:pt-6 pb-3 md:pb-6">
                          <div className="flex items-center gap-1 md:gap-2">
                            <Briefcase className="h-4 w-4 md:h-5 md:w-5 text-green-600" />
                            <div>
                              <span className="text-lg md:text-2xl font-bold">{analytics.overview.recentJobs}</span>
                              <span className="text-xs md:text-sm text-muted-foreground">/{analytics.overview.totalJobs}</span>
                            </div>
                          </div>
                          <p className="text-xs md:text-sm text-muted-foreground mt-1">新增/总岗位</p>
                        </CardContent>
                      </Card>
                      <Card className="flex-shrink-0 w-32 md:w-auto">
                        <CardContent className="pt-4 md:pt-6 pb-3 md:pb-6">
                          <div className="flex items-center gap-1 md:gap-2">
                            <FileText className="h-4 w-4 md:h-5 md:w-5 text-purple-600" />
                            <div>
                              <span className="text-lg md:text-2xl font-bold">{analytics.overview.recentResumes}</span>
                              <span className="text-xs md:text-sm text-muted-foreground">/{analytics.overview.totalResumes}</span>
                            </div>
                          </div>
                          <p className="text-xs md:text-sm text-muted-foreground mt-1">新增/总简历</p>
                        </CardContent>
                      </Card>
                      <Card className="flex-shrink-0 w-32 md:w-auto">
                        <CardContent className="pt-4 md:pt-6 pb-3 md:pb-6">
                          <div className="flex items-center gap-1 md:gap-2">
                            <Send className="h-4 w-4 md:h-5 md:w-5 text-orange-600" />
                            <div>
                              <span className="text-lg md:text-2xl font-bold">{analytics.overview.recentApplications}</span>
                              <span className="text-xs md:text-sm text-muted-foreground">/{analytics.overview.totalApplications}</span>
                            </div>
                          </div>
                          <p className="text-xs md:text-sm text-muted-foreground mt-1">新增/总网申</p>
                        </CardContent>
                      </Card>
                      <Card className="flex-shrink-0 w-32 md:w-auto">
                        <CardContent className="pt-4 md:pt-6 pb-3 md:pb-6">
                          <div className="flex items-center gap-1 md:gap-2">
                            <Activity className="h-4 w-4 md:h-5 md:w-5 text-cyan-600" />
                            <span className="text-lg md:text-2xl font-bold">{analytics.overview.recentAiMatches}</span>
                          </div>
                          <p className="text-xs md:text-sm text-muted-foreground mt-1">AI选岗次数</p>
                        </CardContent>
                      </Card>
                      <Card className="flex-shrink-0 w-32 md:w-auto">
                        <CardContent className="pt-4 md:pt-6 pb-3 md:pb-6">
                          <div className="flex items-center gap-1 md:gap-2">
                            <TrendingUp className="h-4 w-4 md:h-5 md:w-5 text-emerald-600" />
                            <span className="text-lg md:text-2xl font-bold">
                              {analytics.userActivity.length > 0 
                                ? Math.round(analytics.userActivity.reduce((sum, u) => sum + u.resumes + u.applications + u.aiMatches, 0) / analytics.userActivity.length)
                                : 0}
                            </span>
                          </div>
                          <p className="text-xs md:text-sm text-muted-foreground mt-1">平均活跃度</p>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Charts Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                      {/* Jobs by Region */}
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg flex items-center gap-2">
                            <Globe className="h-5 w-5" />
                            岗位地区分布
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            {Object.entries(analytics.charts.jobsByRegion)
                              .sort(([, a], [, b]) => b - a)
                              .slice(0, 6)
                              .map(([region, count]) => {
                                const max = Math.max(...Object.values(analytics.charts.jobsByRegion));
                                const percentage = Math.round((count / max) * 100);
                                return (
                                  <div key={region} className="space-y-1">
                                    <div className="flex justify-between text-sm">
                                      <span>{region}</span>
                                      <span className="text-muted-foreground">{count}</span>
                                    </div>
                                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                                      <div 
                                        className="h-full bg-blue-500 rounded-full transition-all"
                                        style={{ width: `${percentage}%` }}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        </CardContent>
                      </Card>

                      {/* Jobs by Direction */}
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg flex items-center gap-2">
                            <PieChart className="h-5 w-5" />
                            岗位方向分布
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            {Object.entries(analytics.charts.jobsByDirection)
                              .sort(([, a], [, b]) => b - a)
                              .slice(0, 6)
                              .map(([direction, count]) => {
                                const max = Math.max(...Object.values(analytics.charts.jobsByDirection));
                                const percentage = Math.round((count / max) * 100);
                                return (
                                  <div key={direction} className="space-y-1">
                                    <div className="flex justify-between text-sm">
                                      <span>{direction}</span>
                                      <span className="text-muted-foreground">{count}</span>
                                    </div>
                                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                                      <div 
                                        className="h-full bg-purple-500 rounded-full transition-all"
                                        style={{ width: `${percentage}%` }}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        </CardContent>
                      </Card>

                      {/* Applications by Status */}
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg flex items-center gap-2">
                            <Activity className="h-5 w-5" />
                            网申状态分布
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            {Object.entries(analytics.charts.applicationsByStatus)
                              .map(([status, count]) => {
                                const max = Math.max(...Object.values(analytics.charts.applicationsByStatus));
                                const percentage = Math.round((count / max) * 100);
                                const statusColors: Record<string, string> = {
                                  pending: 'bg-yellow-500',
                                  submitted: 'bg-blue-500',
                                  interview: 'bg-purple-500',
                                  rejected: 'bg-red-500',
                                  offer: 'bg-green-500',
                                };
                                return (
                                  <div key={status} className="space-y-1">
                                    <div className="flex justify-between text-sm">
                                      <span>{statusLabels[status] || status}</span>
                                      <span className="text-muted-foreground">{count}</span>
                                    </div>
                                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                                      <div 
                                        className={`h-full ${statusColors[status] || 'bg-gray-500'} rounded-full transition-all`}
                                        style={{ width: `${percentage}%` }}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* User Profile Analysis - 简历用户画像分析 */}
                    {(Object.keys(analytics.charts.resumesByRegion).length > 0 || 
                      Object.keys(analytics.charts.resumesBySchool).length > 0 || 
                      Object.keys(analytics.charts.resumesByDegree).length > 0) && (
                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <GraduationCap className="h-5 w-5" />
                          简历用户画像分析
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                          {/* Resumes by Region - 留学地区 */}
                          {Object.keys(analytics.charts.resumesByRegion).length > 0 && (
                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-base flex items-center gap-2">
                                  <Globe className="h-4 w-4 text-blue-500" />
                                  留学地区分布
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                <div className="space-y-2">
                                  {Object.entries(analytics.charts.resumesByRegion)
                                    .sort(([, a], [, b]) => b - a)
                                    .slice(0, 8)
                                    .map(([region, count]) => {
                                      const max = Math.max(...Object.values(analytics.charts.resumesByRegion));
                                      const percentage = Math.round((count / max) * 100);
                                      return (
                                        <div key={region} className="space-y-1">
                                          <div className="flex justify-between text-sm">
                                            <span className="truncate pr-2">{region}</span>
                                            <span className="text-muted-foreground flex-shrink-0">{count}人</span>
                                          </div>
                                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                                            <div 
                                              className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full transition-all"
                                              style={{ width: `${percentage}%` }}
                                            />
                                          </div>
                                        </div>
                                      );
                                    })}
                                </div>
                              </CardContent>
                            </Card>
                          )}

                          {/* Resumes by School - 学校分布 */}
                          {Object.keys(analytics.charts.resumesBySchool).length > 0 && (
                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-base flex items-center gap-2">
                                  <GraduationCap className="h-4 w-4 text-purple-500" />
                                  学校分布
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                <div className="space-y-2">
                                  {Object.entries(analytics.charts.resumesBySchool)
                                    .sort(([, a], [, b]) => b - a)
                                    .slice(0, 8)
                                    .map(([school, count]) => {
                                      const max = Math.max(...Object.values(analytics.charts.resumesBySchool));
                                      const percentage = Math.round((count / max) * 100);
                                      return (
                                        <div key={school} className="space-y-1">
                                          <div className="flex justify-between text-sm">
                                            <span className="truncate pr-2">{school}</span>
                                            <span className="text-muted-foreground flex-shrink-0">{count}人</span>
                                          </div>
                                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                                            <div 
                                              className="h-full bg-gradient-to-r from-purple-400 to-purple-600 rounded-full transition-all"
                                              style={{ width: `${percentage}%` }}
                                            />
                                          </div>
                                        </div>
                                      );
                                    })}
                                </div>
                              </CardContent>
                            </Card>
                          )}

                          {/* Resumes by Degree - 学历分布 */}
                          {Object.keys(analytics.charts.resumesByDegree).length > 0 && (
                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-base flex items-center gap-2">
                                  <BarChart3 className="h-4 w-4 text-green-500" />
                                  学历分布
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                <div className="space-y-2">
                                  {Object.entries(analytics.charts.resumesByDegree)
                                    .sort(([, a], [, b]) => b - a)
                                    .slice(0, 8)
                                    .map(([degree, count]) => {
                                      const max = Math.max(...Object.values(analytics.charts.resumesByDegree));
                                      const percentage = Math.round((count / max) * 100);
                                      const degreeColors: Record<string, string> = {
                                        '本科': 'from-green-400 to-green-600',
                                        '硕士': 'from-blue-400 to-blue-600',
                                        '博士': 'from-purple-400 to-purple-600',
                                        '大专': 'from-gray-400 to-gray-600',
                                      };
                                      return (
                                        <div key={degree} className="space-y-1">
                                          <div className="flex justify-between text-sm">
                                            <span>{degree}</span>
                                            <span className="text-muted-foreground">{count}人</span>
                                          </div>
                                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                                            <div 
                                              className={`h-full bg-gradient-to-r ${degreeColors[degree] || 'from-gray-400 to-gray-600'} rounded-full transition-all`}
                                              style={{ width: `${percentage}%` }}
                                            />
                                          </div>
                                        </div>
                                      );
                                    })}
                                </div>
                              </CardContent>
                            </Card>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Daily Trend */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <TrendingUp className="h-5 w-5" />
                          近7天活跃趋势
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-end gap-2 h-40">
                          {analytics.charts.dailyStats.map((day) => {
                            const max = Math.max(
                              ...analytics.charts.dailyStats.map(d => Math.max(d.resumes, d.applications, d.aiMatches))
                            ) || 1;
                            return (
                              <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                                <div className="flex-1 w-full flex items-end gap-0.5 justify-center">
                                  <div 
                                    className="w-3 bg-green-500 rounded-t transition-all"
                                    style={{ height: `${(day.resumes / max) * 100}%`, minHeight: day.resumes > 0 ? '4px' : '0' }}
                                    title={`简历: ${day.resumes}`}
                                  />
                                  <div 
                                    className="w-3 bg-blue-500 rounded-t transition-all"
                                    style={{ height: `${(day.applications / max) * 100}%`, minHeight: day.applications > 0 ? '4px' : '0' }}
                                    title={`网申: ${day.applications}`}
                                  />
                                  <div 
                                    className="w-3 bg-purple-500 rounded-t transition-all"
                                    style={{ height: `${(day.aiMatches / max) * 100}%`, minHeight: day.aiMatches > 0 ? '4px' : '0' }}
                                    title={`AI选岗: ${day.aiMatches}`}
                                  />
                                </div>
                                <span className="text-xs text-muted-foreground">
                                  {new Date(day.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex justify-center gap-4 mt-4 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <div className="w-3 h-3 bg-green-500 rounded" />
                            简历
                          </div>
                          <div className="flex items-center gap-1">
                            <div className="w-3 h-3 bg-blue-500 rounded" />
                            网申
                          </div>
                          <div className="flex items-center gap-1">
                            <div className="w-3 h-3 bg-purple-500 rounded" />
                            AI选岗
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* User Activity Table */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Users className="h-5 w-5" />
                          用户活跃度排行
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b">
                                <th className="text-left py-3 px-2">用户</th>
                                <th className="text-center py-3 px-2">简历数</th>
                                <th className="text-center py-3 px-2">网申数</th>
                                <th className="text-center py-3 px-2">AI选岗</th>
                                <th className="text-center py-3 px-2">总活跃度</th>
                              </tr>
                            </thead>
                            <tbody>
                              {analytics.userActivity.slice(0, 10).map((user, index) => (
                                <tr key={user.accessCodeId} className="border-b last:border-0">
                                  <td className="py-3 px-2">
                                    <div className="flex items-center gap-2">
                                      {index < 3 && (
                                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs text-white ${
                                          index === 0 ? 'bg-yellow-500' : index === 1 ? 'bg-gray-400' : 'bg-amber-600'
                                        }`}>
                                          {index + 1}
                                        </span>
                                      )}
                                      <span>{user.accessCodeName}</span>
                                    </div>
                                  </td>
                                  <td className="text-center py-3 px-2">{user.resumes}</td>
                                  <td className="text-center py-3 px-2">{user.applications}</td>
                                  <td className="text-center py-3 px-2">{user.aiMatches}</td>
                                  <td className="text-center py-3 px-2">
                                    <Badge variant="secondary">
                                      {user.resumes + user.applications + user.aiMatches}
                                    </Badge>
                                  </td>
                                </tr>
                              ))}
                              {analytics.userActivity.length === 0 && (
                                <tr>
                                  <td colSpan={5} className="text-center py-8 text-muted-foreground">
                                    暂无用户活动数据
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  </>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    暂无分析数据
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Jobs Tab */}
            <TabsContent value="jobs">
              <Card>
                <CardHeader className="pb-3 md:pb-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base md:text-lg">岗位管理</CardTitle>
                      <CardDescription className="text-xs md:text-sm">添加、编辑和删除岗位信息</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        variant="default"
                        size="sm"
                        className="h-8 text-xs md:text-sm bg-gradient-to-r from-blue-600 to-purple-600 hover:opacity-90"
                        onClick={() => {
                          if (!confirm('智能同步会从公司官网获取最新岗位，并标记已关闭的岗位。是否继续？')) return;
                          const password = prompt('请输入管理员密码：');
                          if (password) {
                            setSyncing(true);
                            setSyncResult(null);
                            fetch('/api/jobs/sync-smart', {
                              method: 'POST',
                              headers: { 'x-admin-password': password }
                            }).then(r => r.json()).then(data => {
                              if (data.message) {
                                const newJobs = data.new_jobs || 0;
                                const closedJobs = data.closed_jobs || 0;
                                setSyncResult({ 
                                  success: 1, 
                                  message: `智能同步完成：新增 ${newJobs} 个岗位，关闭 ${closedJobs} 个`
                                });
                                fetchJobs();
                              } else {
                                setSyncResult({ success: 0, message: data.error || '同步失败' });
                              }
                              setSyncing(false);
                            }).catch(() => {
                              setSyncResult({ success: 0, message: '同步失败，请重试' });
                              setSyncing(false);
                            });
                          }
                        }}
                        disabled={syncing}
                      >
                        <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''} md:mr-2`} />
                        <span className="hidden md:inline">{syncing ? '同步中...' : '智能同步'}</span>
                        <span className="md:hidden">{syncing ? '同步' : '智能'}</span>
                      </Button>
                      <Button 
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
                      </Button>
                      <Dialog open={jobDialogOpen} onOpenChange={(open) => {
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
                              <Input
                                id="company"
                                value={jobForm.company}
                                onChange={(e) => setJobForm({ ...jobForm, company: e.target.value })}
                                placeholder="如：Google"
                                className="h-9 md:h-10"
                              />
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
                              <div className="flex gap-2">
                                <Input
                                  id="url"
                                  value={jobForm.job_url}
                                  onChange={(e) => setJobForm({ ...jobForm, job_url: e.target.value })}
                                  placeholder="https://careers.xxx.com/..."
                                  className="h-9 md:h-10 flex-1"
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={handleFetchFromUrl}
                                  disabled={fetchingFromUrl}
                                  className="h-9 md:h-10 whitespace-nowrap"
                                >
                                  {fetchingFromUrl ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <>
                                      <Wand2 className="h-4 w-4 mr-1" />
                                      智能填充
                                    </>
                                  )}
                                </Button>
                              </div>
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
                              <div className="flex flex-col gap-2">
                                <input
                                  ref={fileInputRef}
                                  type="file"
                                  accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp"
                                  onChange={handleLogoUpload}
                                  className="hidden"
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => fileInputRef.current?.click()}
                                  disabled={logoUploading}
                                >
                                  {logoUploading ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                  ) : (
                                    <Upload className="h-4 w-4 mr-2" />
                                  )}
                                  上传
                                </Button>
                              </div>
                              {jobForm.logo_url && (
                                <div className="relative w-12 h-12 rounded-lg border overflow-hidden bg-white">
                                  <Image
                                    src={jobForm.logo_url}
                                    alt="Logo preview"
                                    fill
                                    className="object-contain p-1"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setJobForm({ ...jobForm, logo_url: '' })}
                                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center text-xs"
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
                              <p className="text-sm text-muted-foreground">开启后，该岗位将在岗位列表中显示为"可投递"状态</p>
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
                    </Dialog>
                    </div>
                  </div>
                </CardHeader>
                {syncResult && (
                  <div className={`px-4 py-2 text-sm ${syncResult.success > 0 ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'}`}>
                    {syncResult.message}
                  </div>
                )}
                <CardContent>
                  {/* Search and Batch Actions */}
                  <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="搜索岗位名称或公司..."
                        value={jobSearch}
                        onChange={(e) => setJobSearch(e.target.value)}
                        className="pl-10 h-9 md:h-10"
                      />
                    </div>
                    {selectedJobIds.size > 0 && (
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

                  {/* Jobs Table - 手机端隐藏部分列 */}
                  <div className="border rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[600px]">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-3 md:px-4 py-2 md:py-3 w-10 md:w-12">
                              <input
                                type="checkbox"
                                checked={filteredJobs.length > 0 && selectedJobIds.size === filteredJobs.length}
                                onChange={toggleSelectAll}
                                className="h-4 w-4 rounded border-gray-300"
                              />
                            </th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium">岗位</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium">公司</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium hidden md:table-cell">地区</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium hidden md:table-cell">方向</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium hidden lg:table-cell">受众</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium hidden lg:table-cell">薪资</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium">状态</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-right text-xs md:text-sm font-medium">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {filteredJobs.map((job) => (
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
                              <td className="px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm hidden lg:table-cell">{job.audience}</td>
                              <td className="px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm text-green-600 hidden lg:table-cell">{job.salary_range}</td>
                              <td className="px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm">
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

            {/* Logos Tab */}
            <TabsContent value="logos">
              <Card>
                <CardHeader className="pb-3 md:pb-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base md:text-lg">企业 Logo 管理</CardTitle>
                      <CardDescription className="text-xs md:text-sm">上传自定义企业 Logo，岗位列表页优先显示</CardDescription>
                    </div>
                    <Button size="sm" className="h-8 text-xs md:text-sm" onClick={() => setLogoDialogOpen(true)}>
                      <Plus className="h-4 w-4 md:mr-2" />
                      <span className="hidden md:inline">上传 Logo</span>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {companyLogos.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>暂无自定义 Logo</p>
                      <p className="text-sm">点击上方按钮上传企业 Logo</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                      {companyLogos.map((logo) => (
                        <div
                          key={logo.id}
                          className="relative group border rounded-lg p-4 bg-card hover:bg-accent/50 transition-colors"
                        >
                          <div className="aspect-square flex items-center justify-center">
                            <img
                              src={logo.logo_url}
                              alt={logo.company_name}
                              className="max-h-12 max-w-full object-contain"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          </div>
                          <p className="text-center text-sm mt-2 truncate">{logo.company_name}</p>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="absolute top-1 right-1 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleLogoDelete(logo.company_name)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Resumes Tab */}
            <TabsContent value="resumes">
              <Card>
                <CardHeader className="pb-3 md:pb-6">
                  <CardTitle className="text-base md:text-lg">简历管理</CardTitle>
                  <CardDescription className="text-xs md:text-sm">查看和管理已上传的简历</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="border rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[500px]">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium">文件名</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium hidden sm:table-cell">上传时间</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium">解析状态</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-right text-xs md:text-sm font-medium">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {resumes.map((resume) => (
                            <tr key={resume.id} className="hover:bg-muted/30">
                              <td className="px-3 md:px-4 py-2 md:py-3">
                                <div className="flex items-center gap-2">
                                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                  <span className="text-xs md:text-sm font-medium truncate max-w-[120px] md:max-w-none">{resume.file_name}</span>
                                </div>
                              </td>
                              <td className="px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm text-muted-foreground hidden sm:table-cell">
                                {new Date(resume.created_at).toLocaleDateString()}
                              </td>
                              <td className="px-3 md:px-4 py-2 md:py-3">
                                <Badge variant={resume.parsed_content ? 'default' : 'secondary'} className="text-xs">
                                  {resume.parsed_content ? '已解析' : '待解析'}
                                </Badge>
                              </td>
                              <td className="px-3 md:px-4 py-2 md:py-3 text-right">
                                <Button 
                                  size="sm" 
                                  variant="ghost" 
                                  className="h-8 w-8 md:w-auto text-destructive"
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
                      <div className="text-center py-8 text-muted-foreground text-sm">
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
                <CardHeader className="pb-3 md:pb-6">
                  <CardTitle className="text-base md:text-lg">网申管理</CardTitle>
                  <CardDescription className="text-xs md:text-sm">查看和管理网申记录</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="border rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[500px]">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium">岗位</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium hidden sm:table-cell">公司</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium">状态</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium hidden md:table-cell">创建时间</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium hidden lg:table-cell">备注</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-right text-xs md:text-sm font-medium">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {applications.map((app) => (
                            <tr key={app.id} className="hover:bg-muted/30">
                              <td className="px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm font-medium truncate max-w-[100px] md:max-w-none">
                                {app.jobs?.title || '未知岗位'}
                              </td>
                              <td className="px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm hidden sm:table-cell">
                                {app.jobs?.company || '未知公司'}
                              </td>
                              <td className="px-3 md:px-4 py-2 md:py-3">
                                <Badge variant={app.status === 'offer' ? 'default' : app.status === 'rejected' ? 'destructive' : 'secondary'} className="text-xs">
                                  {statusLabels[app.status] || app.status}
                                </Badge>
                              </td>
                              <td className="px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm text-muted-foreground hidden md:table-cell">
                                {new Date(app.created_at).toLocaleDateString()}
                              </td>
                              <td className="px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm text-muted-foreground max-w-48 truncate hidden lg:table-cell">
                                {app.notes || '-'}
                              </td>
                              <td className="px-3 md:px-4 py-2 md:py-3 text-right">
                                <Button 
                                  size="sm" 
                                  variant="ghost"
                                  className="h-8 w-8 md:w-auto"
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

            {/* Configs Tab */}
            <TabsContent value="configs">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                {/* Region Config */}
                <Card>
                  <CardHeader className="pb-3 md:pb-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base md:text-lg">地区配置</CardTitle>
                        <CardDescription className="text-xs md:text-sm">管理岗位地区选项</CardDescription>
                      </div>
                      <Button
                        size="sm"
                        className="h-8 w-8 md:w-auto"
                        onClick={() => {
                          setConfigForm({ type: 'region', value: '' });
                          setConfigDialogOpen(true);
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {configs.region?.map((config) => (
                        <div key={config.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                          <span className="text-xs md:text-sm" translate="no">{config.config_value}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive h-7 w-7 p-0"
                            onClick={() => handleDeleteConfig(config.id, 'region')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      {configs.region?.length === 0 && (
                        <p className="text-xs md:text-sm text-muted-foreground text-center py-4">暂无配置</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Direction Config */}
                <Card>
                  <CardHeader className="pb-3 md:pb-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base md:text-lg">方向配置</CardTitle>
                        <CardDescription className="text-xs md:text-sm">管理岗位方向选项</CardDescription>
                      </div>
                      <Button
                        size="sm"
                        className="h-8 w-8 md:w-auto"
                        onClick={() => {
                          setConfigForm({ type: 'direction', value: '' });
                          setConfigDialogOpen(true);
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {configs.direction?.map((config) => (
                        <div key={config.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                          <span className="text-xs md:text-sm" translate="no">{config.config_value}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive h-7 w-7 p-0"
                            onClick={() => handleDeleteConfig(config.id, 'direction')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      {configs.direction?.length === 0 && (
                        <p className="text-xs md:text-sm text-muted-foreground text-center py-4">暂无配置</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Audience Config */}
                <Card>
                  <CardHeader className="pb-3 md:pb-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base md:text-lg">受众配置</CardTitle>
                        <CardDescription className="text-xs md:text-sm">管理岗位受众选项</CardDescription>
                      </div>
                      <Button
                        size="sm"
                        className="h-8 w-8 md:w-auto"
                        onClick={() => {
                          setConfigForm({ type: 'audience', value: '' });
                          setConfigDialogOpen(true);
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {configs.audience?.map((config) => (
                        <div key={config.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                          <span className="text-xs md:text-sm" translate="no">{config.config_value}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive h-7 w-7 p-0"
                            onClick={() => handleDeleteConfig(config.id, 'audience')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      {configs.audience?.length === 0 && (
                        <p className="text-xs md:text-sm text-muted-foreground text-center py-4">暂无配置</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Company Config - 企业配置 */}
              <Card className="mt-4 md:mt-6">
                <CardHeader className="pb-3 md:pb-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base md:text-lg">企业配置</CardTitle>
                      <CardDescription className="text-xs md:text-sm">配置同步企业列表，支持 Greenhouse/Lever ATS</CardDescription>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditingCompany(null);
                        setCompanyForm({ company_name: '', careers_url: '', ats_type: 'manual', ats_id: '', logo_url: '' });
                        setCompanyDialogOpen(true);
                      }}
                    >
                      <Plus className="h-4 w-4 md:mr-2" />
                      <span>添加企业</span>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {companies.length > 0 ? (
                    <div className="border rounded-lg overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[700px]">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium">企业名称</th>
                              <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium hidden sm:table-cell">ATS类型</th>
                              <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium hidden md:table-cell">ATS ID</th>
                              <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium">招聘页面</th>
                              <th className="px-3 md:px-4 py-2 md:py-3 text-right text-xs md:text-sm font-medium">操作</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {companies.map((company) => (
                              <tr key={company.id} className="hover:bg-muted/30">
                                <td className="px-3 md:px-4 py-2 md:py-3">
                                  <span className="text-xs md:text-sm font-medium">{company.company_name}</span>
                                </td>
                                <td className="px-3 md:px-4 py-2 md:py-3 hidden sm:table-cell">
                                  <Badge variant="outline" className="text-xs">
                                    {company.ats_type === 'greenhouse' ? 'Greenhouse' : 
                                     company.ats_type === 'lever' ? 'Lever' : 
                                     company.ats_type === 'builtin' ? 'BuiltIn' : '手动'}
                                  </Badge>
                                </td>
                                <td className="px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm text-muted-foreground hidden md:table-cell">
                                  {company.ats_id || '-'}
                                </td>
                                <td className="px-3 md:px-4 py-2 md:py-3">
                                  {company.careers_url ? (
                                    <a 
                                      href={company.careers_url} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="text-xs md:text-sm text-blue-600 hover:underline"
                                    >
                                      查看
                                    </a>
                                  ) : (
                                    <span className="text-xs md:text-sm text-muted-foreground">-</span>
                                  )}
                                </td>
                                <td className="px-3 md:px-4 py-2 md:py-3">
                                  <div className="flex items-center justify-end gap-1">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0"
                                      onClick={() => handleEditCompany(company)}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-destructive h-7 w-7 p-0"
                                      onClick={() => handleDeleteCompany(company.id)}
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
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Building2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p className="text-sm">暂无企业配置</p>
                      <p className="text-xs mt-1">点击上方按钮添加企业</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Access Codes Tab */}
            <TabsContent value="access-codes">
              <Card>
                <CardHeader className="pb-3 md:pb-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base md:text-lg">访问码管理</CardTitle>
                      <CardDescription className="text-xs md:text-sm">生成和管理用户访问码</CardDescription>
                    </div>
                    <Button size="sm" className="h-8 text-xs md:text-sm" onClick={handleCreateAccessCode}>
                      <Plus className="h-4 w-4 md:mr-2" />
                      <span className="hidden md:inline">生成访问码</span>
                      <span className="md:hidden">生成</span>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="border rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[600px]">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium">访问码</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium hidden sm:table-cell">名称</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium hidden md:table-cell">有效期</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium">过期时间</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium">状态</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-left text-xs md:text-sm font-medium hidden lg:table-cell">最后使用</th>
                            <th className="px-3 md:px-4 py-2 md:py-3 text-right text-xs md:text-sm font-medium">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {accessCodes.map((code) => {
                            const isExpired = new Date(code.expires_at) < new Date();
                            return (
                              <tr key={code.id} className="hover:bg-muted/30">
                                <td className="px-3 md:px-4 py-2 md:py-3">
                                  <code className="bg-muted px-2 py-1 rounded text-xs md:text-sm font-mono">
                                    {code.code}
                                  </code>
                                </td>
                                <td className="px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm hidden sm:table-cell">{code.name}</td>
                                <td className="px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm hidden md:table-cell">{code.duration_days} 天</td>
                                <td className="px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm">
                                  {new Date(code.expires_at).toLocaleDateString('zh-CN')}
                                </td>
                                <td className="px-3 md:px-4 py-2 md:py-3">
                                  {isExpired ? (
                                    <Badge variant="secondary" className="bg-red-100 text-red-700 text-xs">已过期</Badge>
                                  ) : code.is_active ? (
                                    <Badge variant="default" className="bg-green-600 text-xs">有效</Badge>
                                  ) : (
                                    <Badge variant="secondary" className="bg-gray-100 text-gray-600 text-xs">已禁用</Badge>
                                  )}
                                </td>
                                <td className="px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm text-muted-foreground hidden lg:table-cell">
                                  {code.last_used_at 
                                    ? new Date(code.last_used_at).toLocaleDateString('zh-CN')
                                    : '未使用'}
                                </td>
                                <td className="px-3 md:px-4 py-2 md:py-3 text-right">
                                  <div className="flex justify-end gap-1 md:gap-2">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 text-xs hidden sm:flex"
                                      onClick={() => handleToggleAccessCode(code.id, code.is_active)}
                                    >
                                      {code.is_active ? '禁用' : '启用'}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-destructive h-7 w-7 p-0"
                                      onClick={() => handleDeleteAccessCode(code.id)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {accessCodes.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">
                        暂无访问码，点击上方按钮生成
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

      {/* Add Config Dialog */}
      <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              添加{configForm.type === 'region' ? '地区' : configForm.type === 'direction' ? '方向' : '受众'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>名称</Label>
              <Input
                value={configForm.value}
                onChange={(e) => setConfigForm({ ...configForm, value: e.target.value })}
                placeholder={`输入${configForm.type === 'region' ? '地区' : configForm.type === 'direction' ? '方向' : '受众'}名称`}
                translate="no"
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateConfig} disabled={!configForm.value.trim()}>
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Company Config Dialog */}
      <Dialog open={companyDialogOpen} onOpenChange={setCompanyDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingCompany ? '编辑企业' : '添加企业'}
            </DialogTitle>
            <DialogDescription>
              配置企业信息用于智能同步，支持 Greenhouse/Lever ATS 系统
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>企业名称 *</Label>
              <Input
                value={companyForm.company_name}
                onChange={(e) => setCompanyForm({ ...companyForm, company_name: e.target.value })}
                placeholder="如：Goldman Sachs"
                disabled={!!editingCompany}
              />
            </div>
            <div>
              <Label>ATS 类型</Label>
              <select
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                value={companyForm.ats_type}
                onChange={(e) => setCompanyForm({ ...companyForm, ats_type: e.target.value })}
              >
                <option value="manual">手动 (不支持自动同步)</option>
                <option value="greenhouse">Greenhouse</option>
                <option value="lever">Lever</option>
                <option value="builtin">BuiltIn</option>
              </select>
            </div>
            <div>
              <Label>ATS ID</Label>
              <Input
                value={companyForm.ats_id}
                onChange={(e) => setCompanyForm({ ...companyForm, ats_id: e.target.value })}
                placeholder="Greenhouse: 公司短名 / Lever: 公司短名"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Greenhouse: 如 goldmansachs / Lever: 如 goldman-sachs
              </p>
            </div>
            <div>
              <Label>招聘页面 URL</Label>
              <Input
                value={companyForm.careers_url}
                onChange={(e) => setCompanyForm({ ...companyForm, careers_url: e.target.value })}
                placeholder="https://www.goldmansachs.com/careers/..."
              />
            </div>
            <div>
              <Label>Logo URL</Label>
              <Input
                value={companyForm.logo_url}
                onChange={(e) => setCompanyForm({ ...companyForm, logo_url: e.target.value })}
                placeholder="https://..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompanyDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSaveCompany} disabled={!companyForm.company_name.trim()}>
              {editingCompany ? '保存' : '添加'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Import Dialog */}
      <Dialog open={batchImportOpen} onOpenChange={setBatchImportOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>批量导入岗位</DialogTitle>
            <DialogDescription>
              每行一个岗位，字段用 | 或 Tab 或逗号分隔
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Format hint */}
            <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
              <p className="font-medium">格式说明：</p>
              <code className="block bg-background p-2 rounded text-xs overflow-x-auto">
                岗位名称 | 公司名称 | 地区 | 方向 | 受众 | 薪资范围 | JD链接 | 描述
              </code>
              <p className="text-muted-foreground">前5项为必填，后3项可选</p>
              <div className="border-t pt-2 mt-2">
                <p className="font-medium mb-1">示例：</p>
                <code className="block bg-background p-2 rounded text-xs overflow-x-auto">
                  Software Engineer | Google | 美国 | SDE | 应届生 | 15-25万 | https://careers.google.com/xxx
                </code>
              </div>
            </div>

            {/* Input area */}
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

            {/* Result */}
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
                  <p>成功导入：{batchResult.created} / {batchResult.total} 条</p>
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
              <Button onClick={handleBatchImport} disabled={batchImporting || !batchText.trim()}>
                {batchImporting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    导入中...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    开始导入
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

        <LogoUploadDialog
          open={logoDialogOpen}
          onOpenChange={setLogoDialogOpen}
          onSuccess={fetchLogos}
        />
      </div>
    </AdminAuthGuard>
  );
}
