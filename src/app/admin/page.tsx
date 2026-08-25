'use client';

import { Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent } from '@/components/ui/tabs';
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
import { LogoUploadDialog } from '@/components/logo-upload-dialog';
import Image from 'next/image';
import { 
  LayoutDashboard,
  Briefcase,
  Send,
  Users,
  Plus,
  Edit,
  Trash2,
  Search,
  ExternalLink,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  Archive,
  LogOut,
  Settings,
  Upload,
  X,
  BarChart3,
  TrendingUp,
  Activity,
  ClipboardList,
  ImageIcon,
  PieChart,
  Building2,
  Pencil,
  FileText,
  FileSpreadsheet,
  Globe,
  Download,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import { useAdminPermissions } from '@/components/admin-shell';
import { ADMIN_PERMISSIONS } from '@/lib/admin-permission-constants';

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
  file_name: string;
  user_id?: string | null;
  created_at: string;
  updated_at?: string | null;
  processing_status?: string | null;
  processing_stage?: string | null;
  processing_attempts?: number | null;
  profile_version?: number | null;
  segmentation_confirmed?: boolean | null;
  profile_confirmed_at?: string | null;
}

interface CompanyLogoCatalogEntry {
  id: number | null;
  company_name: string;
  logo_url: string | null;
  fallback_logo_url: string | null;
  source: 'uploaded' | 'imported' | 'configured' | 'automatic';
  job_count: number;
  updated_at: string | null;
}

function getCompanyInitial(company: string): string {
  const words = company.trim().split(/[\s&-]+/).filter(Boolean);
  if (/[^\x00-\x7F]/.test(company)) return company.trim().charAt(0) || '?';
  return words.length > 1
    ? `${words[0].charAt(0)}${words[1].charAt(0)}`.toUpperCase()
    : (words[0]?.charAt(0) || '?').toUpperCase();
}

function AdminLogoPreview({ logo }: { logo: CompanyLogoCatalogEntry }) {
  const [source, setSource] = useState<'primary' | 'fallback' | 'initial'>(logo.logo_url ? 'primary' : 'fallback');

  useEffect(() => {
    setSource(logo.logo_url ? 'primary' : logo.fallback_logo_url ? 'fallback' : 'initial');
  }, [logo.logo_url, logo.fallback_logo_url]);

  const imageUrl = source === 'primary'
    ? logo.logo_url
    : source === 'fallback'
      ? logo.fallback_logo_url
      : null;

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={`${logo.company_name} logo`}
        className="h-16 w-16 object-contain"
        loading="lazy"
        onError={() => setSource(source === 'primary' && logo.fallback_logo_url ? 'fallback' : 'initial')}
      />
    );
  }

  return (
    <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-zinc-900 text-base font-semibold text-white dark:bg-white dark:text-zinc-900">
      {getCompanyInitial(logo.company_name)}
    </span>
  );
}

interface Application {
  id: number;
  job_id: number;
  resume_id: number;
  user_id?: string | null;
  status: string;
  notes: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at?: string | null;
  jobs: { title: string; company: string; region?: string; direction?: string } | null;
  resumes: { file_name: string } | null;
}

interface JobSubmission {
  id: number;
  title: string;
  company: string;
  region: string | null;
  direction: string | null;
  job_type: string | null;
  job_url: string | null;
  status: 'pending' | 'approved' | 'rejected';
  notes: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  created_at: string;
}

interface JobFeedStateData {
  configured: boolean;
  healthy: boolean;
  description: string;
  state: {
    source_system: string;
    reconcile_started_at: string | null;
    reconcile_pages: number;
    reconcile_open_seen: number;
    last_incremental_success_at: string | null;
    last_reconcile_success_at: string | null;
    last_error: string | null;
    consecutive_failures: number;
    lease_owner: string | null;
    lease_expires_at: string | null;
    updated_at: string;
  };
}

interface AdminCountSummary {
  total: number;
  byStatus: Record<string, number>;
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
    totalUsers: number;
    recentUsers: number;
    totalResumes: number;
    recentResumes: number;
    totalJobs: number;
    recentJobs: number;
    totalApplications: number;
    recentApplications: number;
    totalAiMatches: number;
    recentAiMatches: number;
    activeUsers: number;
    totalActivityEvents: number;
    averageActivityPerActiveUser: number;
  };
  charts: {
    jobsByRegion: Record<string, number>;
    jobsByDirection: Record<string, number>;
    applicationsByStatus: Record<string, number>;
    dailyStats: { date: string; resumes: number; applications: number; aiMatches: number }[];
  };
  userActivity: { userId: string; userName: string; resumes: number; applications: number; aiMatches: number }[];
}

interface PrefillQualityData {
  overview: {
    totalFeedback: number;
    confirmed: number;
    edited: number;
    ignored: number;
    decided: number;
    confirmationRate: number;
    correctionRate: number;
    contributingUsers: number;
    domains: number;
  };
  dailyStats: { date: string; confirmed: number; edited: number; ignored: number }[];
  fieldQuality: {
    domain: string;
    semanticKey: string;
    totalFeedback: number;
    confirmed: number;
    edited: number;
    ignored: number;
    correctionRate: number;
  }[];
  templateQuality: {
    domainPattern: string;
    atsType: string;
    semanticKey: string;
    usageCount: number;
    correctionCount: number;
    correctionRate: number;
  }[];
}

interface ServiceHealthData {
  overview: {
    callCount: number;
    successfulCalls: number;
    failedCalls: number;
    providersWithCalls: number;
    lastCallAt: string | null;
  };
  providers: {
    provider: string;
    callCount: number;
    successfulCalls: number;
    failedCalls: number;
    successRate: number;
    averageDurationMs: number | null;
    lastCallAt: string | null;
    status: 'healthy' | 'warning' | 'degraded' | 'unknown';
  }[];
  failureHotspots: {
    provider: string;
    feature: string;
    failedCalls: number;
    callCount: number;
    failureRate: number;
    lastCallAt: string | null;
  }[];
  jobSync: {
    sourceSystem: string;
    lastIncrementalSuccessAt: string | null;
    lastReconcileSuccessAt: string | null;
    lastErrorAt: string | null;
    consecutiveFailures: number;
    syncInProgress: boolean;
    updatedAt: string;
    status: 'healthy' | 'running' | 'degraded' | 'stale' | 'unknown';
  }[];
}

interface AiUsageSummary {
  call_count: number;
  successful_calls: number;
  failed_calls: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  actual_calls: number;
  estimated_calls: number;
  unknown_calls: number;
  audio_calls: number;
  input_audio_seconds: number;
  output_audio_seconds: number;
  input_audio_bytes: number;
  output_audio_bytes: number;
  audio_tokens: number;
  text_characters: number;
  billing_units: number;
  priced_calls: number;
  unpriced_calls: number;
  estimated_costs: Record<string, number | string>;
}

interface AiUsageFeatureSummary extends AiUsageSummary {
  feature: string;
}

interface AiUsageEvent {
  id: number;
  request_id: string;
  user_id: string | null;
  feature: string;
  provider: string;
  model: string | null;
  status: 'success' | 'error';
  usage_source: 'actual' | 'estimated' | 'unknown';
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  modality: 'text' | 'audio';
  input_audio_seconds: number | null;
  output_audio_seconds: number | null;
  input_audio_bytes: number | null;
  output_audio_bytes: number | null;
  audio_tokens: number | null;
  text_characters: number | null;
  measurement_source: string;
  error_message: string | null;
  duration_ms: number | null;
  estimated_cost: number | string | null;
  currency: string;
  cost_source: 'priced' | 'unpriced';
  interview_session_id?: number | null;
  billing_unit?: string | null;
  billing_units?: number | string | null;
  phase?: string | null;
  fallback?: boolean;
  retry_count?: number | null;
  metadata?: Record<string, unknown> | null;
  error_code?: string | null;
  created_at: string;
}

interface AiUsageStudentSummary extends AiUsageSummary {
  user_id: string;
  display_name: string;
}

interface AiUsageData {
  summary: AiUsageSummary;
  features: AiUsageFeatureSummary[];
  events: AiUsageEvent[];
}

interface AiModelPrice {
  id: number;
  provider: string;
  model: string;
  currency: string;
  input_token_price_per_million: number | string | null;
  output_token_price_per_million: number | string | null;
  audio_second_price: number | string | null;
  billing_unit_price: number | string | null;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  notes: string | null;
}

interface AdminAuditLog {
  id: number;
  actor_type: string;
  actor_fingerprint: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  subject_user_id: string | null;
  metadata: Record<string, unknown>;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  success: boolean;
  error_code: string | null;
  error_message: string | null;
  request_id: string;
  request_ip: string | null;
  user_agent: string | null;
  created_at: string;
}

const aiFeatureLabels: Record<string, string> = {
  ai_match: 'AI 选岗',
  resume_optimize: '简历优化',
  resume_score: '简历评分',
  resume_translate: '简历翻译',
  resume_translate_content: '简历内容翻译',
  resume_parse: '简历解析',
  resume_profile: '简历画像',
  company_dna: '企业面试基因',
  job_description: '岗位描述生成',
  application_prefill: '网申智能预填',
  interview_chat: '面试对话',
  interview_summary: '面试总结',
  interview_asr: '面试语音识别',
  interview_asr_realtime: '实时语音识别',
  interview_tts: '面试语音合成',
  interview_tts_realtime: '实时语音合成',
};

const aiFeatureOptions = Object.keys(aiFeatureLabels);

function formatTokenCount(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '未知';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? new Intl.NumberFormat('zh-CN').format(parsed) : '未知';
}

function formatAudioMinutes(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '未知';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(parsed / 60) : '未知';
}

function formatAudioSeconds(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '未测量';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(parsed >= 10 ? 1 : 2)} 秒` : '未测量';
}

function formatAudioBytes(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '未知';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '未知';
  if (parsed < 1024) return `${parsed} B`;
  if (parsed < 1024 * 1024) return `${(parsed / 1024).toFixed(1)} KB`;
  return `${(parsed / (1024 * 1024)).toFixed(2)} MB`;
}

function formatAiFeature(feature: string): string {
  return aiFeatureLabels[feature] || feature;
}

function formatEstimatedCosts(costs: Record<string, number | string> | null | undefined): string {
  const entries = Object.entries(costs || {}).filter(([, value]) => Number.isFinite(Number(value)));
  if (entries.length === 0) return '未定价';
  return entries
    .sort(([currencyA], [currencyB]) => currencyA.localeCompare(currencyB))
    .map(([currency, value]) => `${currency} ${Number(value).toFixed(4)}`)
    .join(' / ');
}

function formatModelPrice(price: AiModelPrice): string {
  if (price.input_token_price_per_million !== null || price.output_token_price_per_million !== null) {
    return `输入 ${price.input_token_price_per_million ?? '-'} / 输出 ${price.output_token_price_per_million ?? '-'} 每百万 Token`;
  }
  if (price.audio_second_price !== null) return `${price.audio_second_price} / 音频秒`;
  return `${price.billing_unit_price ?? '-'} / 自定义计费单位`;
}

function formatAuditPayload(value: Record<string, unknown> | null): string {
  if (!value || Object.keys(value).length === 0) return '-';
  try {
    return JSON.stringify(value);
  } catch {
    return '[无法显示]';
  }
}

function getAiUsageDateRange(range: '7d' | '30d' | '90d' | 'all'): { from?: string; to: string } {
  const to = new Date().toISOString();
  if (range === 'all') return { to };
  const from = new Date();
  from.setDate(from.getDate() - Number(range.slice(0, -1)));
  return { from: from.toISOString(), to };
}

const statusOptions = ['pending', 'filling', 'submitted', 'closed'];

const statusLabels: Record<string, string> = {
  pending: '待投递',
  filling: '填写中',
  submitted: '已投递',
  closed: '已关闭',
};

const resumeStatusLabels: Record<string, string> = {
  uploaded: '已上传',
  extracting_text: '提取文本中',
  extracting_profile: '生成画像中',
  deriving_segmentation: '计算分层中',
  needs_confirmation: '待确认',
  ready: '已完成',
  failed: '处理失败',
};

const adminTabs = [
  { value: 'overview', permission: ADMIN_PERMISSIONS.dashboardRead },
  { value: 'analytics', permission: ADMIN_PERMISSIONS.dashboardRead },
  { value: 'prefill-quality', permission: ADMIN_PERMISSIONS.dashboardRead },
  { value: 'service-health', permission: ADMIN_PERMISSIONS.dashboardRead },
  { value: 'ai-usage', permission: ADMIN_PERMISSIONS.dashboardRead },
  { value: 'jobs', permission: ADMIN_PERMISSIONS.jobsRead },
  { value: 'job-submissions', permission: ADMIN_PERMISSIONS.jobsRead },
  { value: 'logos', permission: ADMIN_PERMISSIONS.configWrite },
  { value: 'resumes', permission: ADMIN_PERMISSIONS.usersRead },
  { value: 'applications', permission: ADMIN_PERMISSIONS.usersRead },
  { value: 'configs', permission: ADMIN_PERMISSIONS.configWrite },
  { value: 'audit', permission: ADMIN_PERMISSIONS.auditRead },
] as const;

type AdminTab = typeof adminTabs[number]['value'];

const adminTabMeta: Record<AdminTab, { title: string; description: string }> = {
  overview: { title: '运营概览', description: '核心业务数据与待处理事项' },
  analytics: { title: '业务数据分析', description: '查看用户、简历、网申和岗位趋势' },
  'prefill-quality': { title: '网申质量', description: '查看字段映射与预填反馈质量' },
  'service-health': { title: '服务健康', description: '监控 AI 调用与岗位同步状态' },
  'ai-usage': { title: 'AI 用量与成本', description: '按功能、学生和模型查看用量' },
  jobs: { title: '岗位管理', description: '管理岗位内容与数据同步' },
  'job-submissions': { title: '投稿审核', description: '审核用户提交的岗位线索' },
  logos: { title: '品牌资源', description: '管理企业 Logo 与展示资源' },
  resumes: { title: '简历处理', description: '查看简历解析与画像处理状态' },
  applications: { title: '网申记录', description: '查看投递进度与运营状态' },
  configs: { title: '岗位与企业配置', description: '维护地区、方向、受众和企业资料' },
  audit: { title: '审计日志', description: '查看后台操作的安全记录' },
};

const workspaceTabs: Array<{ label: string; tabs: AdminTab[] }> = [
  { label: '数据与质量', tabs: ['analytics', 'prefill-quality', 'ai-usage', 'service-health'] },
  { label: '岗位工作台', tabs: ['jobs', 'job-submissions'] },
  { label: '简历与网申', tabs: ['resumes', 'applications'] },
  { label: '配置与品牌', tabs: ['configs', 'logos'] },
];

function AdminContent() {
  const { loading: permissionsLoading, hasPermission } = useAdminPermissions();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const availableTabs = adminTabs.filter((tab) => hasPermission(tab.permission));
  const fallbackTab: AdminTab = availableTabs[0]?.value || 'overview';
  const requestedTabIsAvailable = availableTabs.some((tab) => tab.value === requestedTab);
  const activeTab: AdminTab = requestedTabIsAvailable ? requestedTab as AdminTab : fallbackTab;
  const canReadDashboard = hasPermission(ADMIN_PERMISSIONS.dashboardRead);
  const canReadJobs = hasPermission(ADMIN_PERMISSIONS.jobsRead);
  const canWriteJobs = hasPermission(ADMIN_PERMISSIONS.jobsWrite);
  const canReadUsers = hasPermission(ADMIN_PERMISSIONS.usersRead);
  const canExportUsage = hasPermission(ADMIN_PERMISSIONS.usageExport);
  const canWriteConfig = hasPermission(ADMIN_PERMISSIONS.configWrite);
  const canReadAudit = hasPermission(ADMIN_PERMISSIONS.auditRead);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsPage, setJobsPage] = useState(0);
  const jobsPageSize = 50;
  const [jobsTotal, setJobsTotal] = useState(0);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState('');
  const jobsRequestRef = useRef(0);
  const [jobSubmissions, setJobSubmissions] = useState<JobSubmission[]>([]);
  const [jobSubmissionsPage, setJobSubmissionsPage] = useState(1);
  const [jobSubmissionsTotal, setJobSubmissionsTotal] = useState(0);
  const [jobSubmissionsStatus, setJobSubmissionsStatus] = useState('pending');
  const [jobSubmissionsSearch, setJobSubmissionsSearch] = useState('');
  const [jobSubmissionsLoading, setJobSubmissionsLoading] = useState(false);
  const [jobSubmissionsError, setJobSubmissionsError] = useState('');
  const [reviewingSubmission, setReviewingSubmission] = useState<JobSubmission | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [submissionReviewAction, setSubmissionReviewAction] = useState<'approve' | 'reject' | null>(null);
  const [submissionReviewSaving, setSubmissionReviewSaving] = useState(false);
  const jobSubmissionsPageSize = 20;
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [resumesPage, setResumesPage] = useState(1);
  const [applicationsPage, setApplicationsPage] = useState(1);
  const resumesPageSize = 20;
  const applicationsPageSize = 20;
  const [resumesTotal, setResumesTotal] = useState(0);
  const [applicationsTotal, setApplicationsTotal] = useState(0);
  const [resumeSummary, setResumeSummary] = useState<AdminCountSummary>({ total: 0, byStatus: {} });
  const [applicationSummary, setApplicationSummary] = useState<AdminCountSummary>({ total: 0, byStatus: {} });
  const [resumeSearch, setResumeSearch] = useState('');
  const [applicationSearch, setApplicationSearch] = useState('');
  const [resumeStatus, setResumeStatus] = useState('all');
  const [applicationStatus, setApplicationStatus] = useState('all');
  const resumesRequestRef = useRef(0);
  const applicationsRequestRef = useRef(0);
  const [loading, setLoading] = useState(false);
  
  // Analytics state
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');
  const [analyticsRange, setAnalyticsRange] = useState<'7d' | '30d' | '90d' | 'all'>('7d');
  const [prefillQuality, setPrefillQuality] = useState<PrefillQualityData | null>(null);
  const [prefillQualityLoading, setPrefillQualityLoading] = useState(false);
  const [prefillQualityError, setPrefillQualityError] = useState('');
  const [prefillQualityRange, setPrefillQualityRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [serviceHealth, setServiceHealth] = useState<ServiceHealthData | null>(null);
  const [serviceHealthLoading, setServiceHealthLoading] = useState(false);
  const [serviceHealthError, setServiceHealthError] = useState('');
  const [serviceHealthRange, setServiceHealthRange] = useState<'24h' | '7d' | '30d'>('24h');

  // AI usage state
  const [aiUsage, setAiUsage] = useState<AiUsageData | null>(null);
  const [aiUsageStudents, setAiUsageStudents] = useState<AiUsageStudentSummary[]>([]);
  const [aiUsageLoading, setAiUsageLoading] = useState(false);
  const [aiUsageError, setAiUsageError] = useState('');
  const [aiUsageExporting, setAiUsageExporting] = useState(false);
  const [aiUsageRange, setAiUsageRange] = useState<'7d' | '30d' | '90d' | 'all'>('7d');
  const [aiUsageFeature, setAiUsageFeature] = useState('all');
  const [aiUsageProvider, setAiUsageProvider] = useState('all');
  const [aiUsageStatus, setAiUsageStatus] = useState('all');
  const [aiUsageSource, setAiUsageSource] = useState('all');
  const [aiUsagePage, setAiUsagePage] = useState(1);
  const [aiUsageStudentPage, setAiUsageStudentPage] = useState(1);
  const [aiUsageTotal, setAiUsageTotal] = useState(0);
  const [aiUsageStudentTotal, setAiUsageStudentTotal] = useState(0);
  const [aiModelPrices, setAiModelPrices] = useState<AiModelPrice[]>([]);
  const [aiPricesLoading, setAiPricesLoading] = useState(false);
  const [aiPricesError, setAiPricesError] = useState('');
  const [aiPriceDialogOpen, setAiPriceDialogOpen] = useState(false);
  const [aiPriceSaving, setAiPriceSaving] = useState(false);
  const [aiPriceForm, setAiPriceForm] = useState({
    provider: 'alibaba',
    model: '',
    currency: 'USD',
    inputTokenPricePerMillion: '',
    outputTokenPricePerMillion: '',
    audioSecondPrice: '',
    billingUnitPrice: '',
    effectiveFrom: '',
    notes: '',
  });
  const aiUsagePageSize = 10;
  const aiUsageStudentPageSize = 10;

  // Admin audit state
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [auditAction, setAuditAction] = useState('all');
  const [auditResourceType, setAuditResourceType] = useState('all');
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const auditPageSize = 15;

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
    careers_page: string;
    ats_type: string;
    ats_id: string;
    logo_url: string;
  }
  const [companies, setCompanies] = useState<CompanyConfig[]>([]);
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);
  const [companyForm, setCompanyForm] = useState({
    company_name: '',
    short_desc: '',
    full_desc: '',
    industry: '',
    headquarters: '',
    founded_year: '',
    employees: '',
    careers_page: '',
    logo_url: '',
  });
  const [editingCompany, setEditingCompany] = useState<CompanyConfig | null>(null);

  // Company logos state
  const [companyLogos, setCompanyLogos] = useState<CompanyLogoCatalogEntry[]>([]);
  const [logoDialogOpen, setLogoDialogOpen] = useState(false);
  const [logoDialogCompanyName, setLogoDialogCompanyName] = useState('');
  const [logoForm, setLogoForm] = useState({ company_name: '', logo: null as File | null });
  const [logoUploading, setLogoUploading] = useState(false);
  const [logosLoading, setLogosLoading] = useState(false);
  const [logosError, setLogosError] = useState('');
  const [logoSearch, setLogoSearch] = useState('');

  const openLogoEditor = (companyName = '') => {
    setLogoDialogCompanyName(companyName);
    setLogoDialogOpen(true);
  };



  // Change password
  const handleChangePassword = async () => {
    setPasswordError('');
    setPasswordSuccess('');

    if (!oldPassword || !newPassword || !confirmPassword) {
      setPasswordError('请填写所有字段');
      return;
    }

    if (newPassword.length < 12) {
      setPasswordError('新密码至少12位');
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

  // Fetch company logos
  const fetchLogos = async () => {
    setLogosLoading(true);
    setLogosError('');
    try {
      const response = await fetch('/api/admin/company-logos');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '获取图标库失败');
      }
      if (Array.isArray(data.logos)) {
        setCompanyLogos(data.logos);
      }
    } catch (error) {
      console.error('Error fetching logos:', error);
      setLogosError(error instanceof Error ? error.message : '获取图标库失败');
    } finally {
      setLogosLoading(false);
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
  const [feedSyncing, setFeedSyncing] = useState(false);
  const [feedSyncMessage, setFeedSyncMessage] = useState('');
  const [jobFeedState, setJobFeedState] = useState<JobFeedStateData | null>(null);
  const [jobFeedStateLoading, setJobFeedStateLoading] = useState(false);
  const [jobFeedStateError, setJobFeedStateError] = useState('');
  const [reconcileConfirmOpen, setReconcileConfirmOpen] = useState(false);
  const [batchResult, setBatchResult] = useState<{
    success?: boolean;
    created?: number;
    skipped?: number;
    total?: number;
    invalidCount?: number;
    invalidJobs?: { index: number; reason: string; data: Record<string, unknown> }[];
  } | null>(null);
  const [importMode, setImportMode] = useState<'file' | 'text'>('file');
  const [previewJobs, setPreviewJobs] = useState<Job[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState('');

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
    if (permissionsLoading || requestedTabIsAvailable || availableTabs.length === 0) return;
    const params = new URLSearchParams(searchParams.toString());
    if (fallbackTab === 'overview') params.delete('tab');
    else params.set('tab', fallbackTab);
    router.replace(params.size > 0 ? `${pathname}?${params.toString()}` : pathname);
  }, [availableTabs.length, fallbackTab, pathname, permissionsLoading, requestedTabIsAvailable, router, searchParams]);

  useEffect(() => {
    if (canWriteConfig) void fetchData();
  }, [canWriteConfig]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [configsRes, companiesRes] = await Promise.all([
        fetch('/api/admin/configs?page=1&pageSize=100'),
        fetch('/api/admin/company-config'),
      ]);
      const configsData = await configsRes.json();
      const companiesData = await companiesRes.json();
      if (!configsRes.ok) throw new Error(configsData.error?.message || '配置加载失败');
      if (!companiesRes.ok) throw new Error(companiesData.error || '企业配置加载失败');
      setConfigs(configsData.configs || {});
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

  const fetchJobFeedState = async () => {
    setJobFeedStateLoading(true);
    setJobFeedStateError('');
    try {
      const response = await fetch('/api/jobs/sync-feed', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '读取岗位同步状态失败');
      setJobFeedState(data as JobFeedStateData);
    } catch (error) {
      setJobFeedState(null);
      setJobFeedStateError(error instanceof Error ? error.message : '读取岗位同步状态失败');
    } finally {
      setJobFeedStateLoading(false);
    }
  };

  const fetchJobSubmissions = async (
    requestedPage = jobSubmissionsPage,
    requestedStatus = jobSubmissionsStatus,
    requestedSearch = jobSubmissionsSearch,
  ) => {
    setJobSubmissionsLoading(true);
    setJobSubmissionsError('');
    try {
      const params = new URLSearchParams({ page: String(requestedPage), pageSize: String(jobSubmissionsPageSize), status: requestedStatus });
      if (requestedSearch.trim()) params.set('search', requestedSearch.trim());
      const response = await fetch(`/api/admin/job-submissions?${params.toString()}`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '岗位投稿加载失败');
      setJobSubmissions(json.data || []);
      setJobSubmissionsTotal(Number(json.meta?.total || 0));
    } catch (error) {
      console.error('Failed to fetch job submissions:', error);
      setJobSubmissionsError(error instanceof Error ? error.message : '岗位投稿加载失败');
      setJobSubmissions([]);
      setJobSubmissionsTotal(0);
    } finally {
      setJobSubmissionsLoading(false);
    }
  };

  const handleJobSubmissionReview = async () => {
    if (!reviewingSubmission || !submissionReviewAction) return;
    setSubmissionReviewSaving(true);
    try {
      const response = await fetch('/api/admin/job-submissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: reviewingSubmission.id, action: submissionReviewAction, notes: reviewNotes }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '岗位投稿审核失败');
      setReviewingSubmission(null);
      setReviewNotes('');
      setSubmissionReviewAction(null);
      await fetchJobSubmissions();
    } catch (error) {
      alert(error instanceof Error ? error.message : '岗位投稿审核失败');
    } finally {
      setSubmissionReviewSaving(false);
    }
  };

  const handleJobSubmissionDelete = async (submission: JobSubmission) => {
    if (!confirm(`确定删除“${submission.company} - ${submission.title}”这条投稿吗？`)) return;
    try {
      const response = await fetch(`/api/admin/job-submissions?id=${submission.id}`, { method: 'DELETE' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '删除岗位投稿失败');
      const remaining = jobSubmissions.length - 1;
      if (remaining === 0 && jobSubmissionsPage > 1) setJobSubmissionsPage((page) => page - 1);
      else await fetchJobSubmissions();
    } catch (error) {
      alert(error instanceof Error ? error.message : '删除岗位投稿失败');
    }
  };

  const fetchResumesPage = async (
    requestedPage = resumesPage,
    requestedSearch = resumeSearch,
    requestedStatus = resumeStatus,
  ) => {
    const requestId = ++resumesRequestRef.current;
    const params = new URLSearchParams({
      page: String(requestedPage),
      pageSize: String(resumesPageSize),
    });
    if (requestedSearch.trim()) params.set('search', requestedSearch.trim());
    if (requestedStatus !== 'all') params.set('status', requestedStatus);

    try {
      const response = await fetch(`/api/admin/resumes?${params.toString()}`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '简历加载失败');
      if (requestId !== resumesRequestRef.current) return;
      setResumes(json.data || []);
      setResumesTotal(Number(json.meta?.total || 0));
      setResumeSummary(json.summary || { total: 0, byStatus: {} });
    } catch (error) {
      if (requestId !== resumesRequestRef.current) return;
      console.error('Failed to fetch admin resumes:', error);
      setResumes([]);
      setResumesTotal(0);
      setResumeSummary({ total: 0, byStatus: {} });
    }
  };

  const fetchApplicationsPage = async (
    requestedPage = applicationsPage,
    requestedSearch = applicationSearch,
    requestedStatus = applicationStatus,
  ) => {
    const requestId = ++applicationsRequestRef.current;
    const params = new URLSearchParams({
      page: String(requestedPage),
      pageSize: String(applicationsPageSize),
    });
    if (requestedSearch.trim()) params.set('search', requestedSearch.trim());
    if (requestedStatus !== 'all') params.set('status', requestedStatus);

    try {
      const response = await fetch(`/api/admin/applications?${params.toString()}`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '网申加载失败');
      if (requestId !== applicationsRequestRef.current) return;
      setApplications(json.data || []);
      setApplicationsTotal(Number(json.meta?.total || 0));
      setApplicationSummary(json.summary || { total: 0, byStatus: {} });
    } catch (error) {
      if (requestId !== applicationsRequestRef.current) return;
      console.error('Failed to fetch admin applications:', error);
      setApplications([]);
      setApplicationsTotal(0);
      setApplicationSummary({ total: 0, byStatus: {} });
    }
  };

  useEffect(() => {
    if (canReadUsers && activeTab === 'resumes') void fetchResumesPage();
  }, [activeTab, canReadUsers, resumesPage, resumeSearch, resumeStatus]);

  useEffect(() => {
    if (canReadUsers && activeTab === 'applications') void fetchApplicationsPage();
  }, [activeTab, applicationSearch, applicationStatus, applicationsPage, canReadUsers]);

  useEffect(() => {
    if (canReadJobs && (activeTab === 'jobs' || activeTab === 'overview')) void fetchJobsPage();
  }, [activeTab, canReadJobs, jobSearch, jobsPage]);

  useEffect(() => {
    if (canReadJobs && activeTab === 'job-submissions') void fetchJobSubmissions();
  }, [activeTab, canReadJobs, jobSubmissionsPage, jobSubmissionsSearch, jobSubmissionsStatus]);

  useEffect(() => {
    if (canReadJobs && !canWriteConfig && activeTab === 'jobs') void fetchJobOptions();
  }, [activeTab, canReadJobs, canWriteConfig]);

  useEffect(() => {
    if (canWriteJobs && activeTab === 'jobs') void fetchJobFeedState();
  }, [activeTab, canWriteJobs]);

  // Fetch analytics data
  const fetchAnalytics = async () => {
    setAnalyticsLoading(true);
    setAnalyticsError('');
    try {
      const response = await fetch(`/api/admin/analytics?range=${analyticsRange}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) {
        const required = Array.isArray(data.error?.requiredMigrations) ? `（所需迁移：${data.error.requiredMigrations.join('、')}）` : '';
        throw new Error(`${data.error?.message || '分析数据加载失败'}${required}`);
      }
      if (!data.data) {
        setAnalytics(null);
        return;
      }
      setAnalytics(data.data || null);
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
      setAnalyticsError(error instanceof Error ? error.message : '分析数据加载失败');
      setAnalytics(null);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const fetchPrefillQuality = useCallback(async () => {
    setPrefillQualityLoading(true);
    setPrefillQualityError('');
    try {
      const response = await fetch(`/api/admin/prefill-quality?range=${prefillQualityRange}`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) {
        const required = Array.isArray(json.error?.requiredMigrations) ? `（所需迁移：${json.error.requiredMigrations.join('、')}）` : '';
        throw new Error(`${json.error?.message || '网申预填质量加载失败'}${required}`);
      }
      setPrefillQuality(json.data || null);
    } catch (error) {
      console.error('Failed to fetch prefill quality:', error);
      setPrefillQualityError(error instanceof Error ? error.message : '网申预填质量加载失败');
      setPrefillQuality(null);
    } finally {
      setPrefillQualityLoading(false);
    }
  }, [prefillQualityRange]);

  const fetchServiceHealth = useCallback(async () => {
    setServiceHealthLoading(true);
    setServiceHealthError('');
    try {
      const response = await fetch(`/api/admin/service-health?range=${serviceHealthRange}`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) {
        const required = Array.isArray(json.error?.requiredMigrations) ? `（所需迁移：${json.error.requiredMigrations.join('、')}）` : '';
        throw new Error(`${json.error?.message || '服务健康数据加载失败'}${required}`);
      }
      setServiceHealth(json.data || null);
    } catch (error) {
      console.error('Failed to fetch service health:', error);
      setServiceHealthError(error instanceof Error ? error.message : '服务健康数据加载失败');
      setServiceHealth(null);
    } finally {
      setServiceHealthLoading(false);
    }
  }, [serviceHealthRange]);

  const fetchAiUsage = useCallback(async () => {
    setAiUsageLoading(true);
    setAiUsageError('');
    const dateRange = getAiUsageDateRange(aiUsageRange);
    const commonParams = new URLSearchParams({ pageSize: String(aiUsagePageSize) });
    if (aiUsageFeature !== 'all') commonParams.set('feature', aiUsageFeature);
    if (aiUsageProvider !== 'all') commonParams.set('provider', aiUsageProvider);
    if (aiUsageStatus !== 'all') commonParams.set('status', aiUsageStatus);
    if (aiUsageSource !== 'all') commonParams.set('usageSource', aiUsageSource);
    if (dateRange.from) commonParams.set('from', dateRange.from);
    commonParams.set('to', dateRange.to);

    const eventParams = new URLSearchParams(commonParams);
    eventParams.set('page', String(aiUsagePage));

    try {
      const usageResponse = await fetch(`/api/admin/ai-usage?${eventParams.toString()}`, { cache: 'no-store' });
      const usageJson = await usageResponse.json();
      if (!usageResponse.ok) {
        const required = Array.isArray(usageJson.error?.requiredMigrations) ? `（所需迁移：${usageJson.error.requiredMigrations.join('、')}）` : '';
        throw new Error(`${usageJson.error?.message || 'AI 用量加载失败'}${required}`);
      }

      setAiUsage(usageJson.data || null);
      setAiUsageTotal(Number(usageJson.meta?.total || 0));
    } catch (error) {
      console.error('Failed to fetch AI usage:', error);
      setAiUsageError(error instanceof Error ? error.message : 'AI 用量加载失败');
      setAiUsage(null);
    } finally {
      setAiUsageLoading(false);
    }
  }, [aiUsageFeature, aiUsagePage, aiUsageProvider, aiUsageRange, aiUsageSource, aiUsageStatus]);

  const fetchAiUsageStudents = useCallback(async () => {
    const dateRange = getAiUsageDateRange(aiUsageRange);
    const params = new URLSearchParams({ page: String(aiUsageStudentPage), pageSize: String(aiUsageStudentPageSize) });
    if (aiUsageFeature !== 'all') params.set('feature', aiUsageFeature);
    if (aiUsageProvider !== 'all') params.set('provider', aiUsageProvider);
    if (aiUsageStatus !== 'all') params.set('status', aiUsageStatus);
    if (aiUsageSource !== 'all') params.set('usageSource', aiUsageSource);
    if (dateRange.from) params.set('from', dateRange.from);
    params.set('to', dateRange.to);
    try {
      const response = await fetch(`/api/admin/ai-usage/students?${params.toString()}`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '学生用量加载失败');
      setAiUsageStudents(json.data?.students || []);
      setAiUsageStudentTotal(Number(json.meta?.total || 0));
    } catch (error) {
      console.error('Failed to fetch AI usage students:', error);
      setAiUsageStudents([]);
      setAiUsageStudentTotal(0);
    }
  }, [aiUsageFeature, aiUsageProvider, aiUsageRange, aiUsageSource, aiUsageStatus, aiUsageStudentPage]);

  const handleAiUsageExport = async () => {
    setAiUsageExporting(true);
    try {
      const dateRange = getAiUsageDateRange(aiUsageRange);
      const params = new URLSearchParams();
      if (aiUsageFeature !== 'all') params.set('feature', aiUsageFeature);
      if (aiUsageProvider !== 'all') params.set('provider', aiUsageProvider);
      if (aiUsageStatus !== 'all') params.set('status', aiUsageStatus);
      if (aiUsageSource !== 'all') params.set('usageSource', aiUsageSource);
      if (dateRange.from) params.set('from', dateRange.from);
      params.set('to', dateRange.to);
      const response = await fetch(`/api/admin/ai-usage/export?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.error?.message || '导出 AI 使用量失败');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `liorvix-ai-usage-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(error instanceof Error ? error.message : '导出 AI 使用量失败');
    } finally {
      setAiUsageExporting(false);
    }
  };

  const fetchAiModelPrices = useCallback(async () => {
    setAiPricesLoading(true);
    setAiPricesError('');
    try {
      const response = await fetch('/api/admin/ai-prices?page=1&pageSize=100', { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) {
        const required = Array.isArray(json.error?.requiredMigrations) ? `（所需迁移：${json.error.requiredMigrations.join('、')}）` : '';
        throw new Error(`${json.error?.message || '模型价格加载失败'}${required}`);
      }
      setAiModelPrices(json.data || []);
    } catch (error) {
      console.error('Failed to fetch AI model prices:', error);
      setAiPricesError(error instanceof Error ? error.message : '模型价格加载失败');
      setAiModelPrices([]);
    } finally {
      setAiPricesLoading(false);
    }
  }, []);

  const handleCreateAiPrice = async () => {
    setAiPriceSaving(true);
    try {
      const response = await fetch('/api/admin/ai-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiPriceForm),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '创建模型价格失败');
      setAiPriceDialogOpen(false);
      setAiPriceForm({
        provider: 'alibaba', model: '', currency: 'USD', inputTokenPricePerMillion: '', outputTokenPricePerMillion: '',
        audioSecondPrice: '', billingUnitPrice: '', effectiveFrom: '', notes: '',
      });
      await Promise.all([fetchAiModelPrices(), fetchAiUsage()]);
    } catch (error) {
      alert(error instanceof Error ? error.message : '创建模型价格失败');
    } finally {
      setAiPriceSaving(false);
    }
  };

  const handleAiPriceStatus = async (price: AiModelPrice) => {
    try {
      const response = await fetch('/api/admin/ai-prices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: price.id, isActive: !price.is_active }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || '更新模型价格失败');
      await fetchAiModelPrices();
    } catch (error) {
      alert(error instanceof Error ? error.message : '更新模型价格失败');
    }
  };

  const fetchAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    setAuditError('');
    const params = new URLSearchParams({
      page: String(auditPage),
      pageSize: String(auditPageSize),
    });
    if (auditAction !== 'all') params.set('action', auditAction);
    if (auditResourceType !== 'all') params.set('resourceType', auditResourceType);

    try {
      const response = await fetch(`/api/admin/audit-logs?${params.toString()}`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) {
        const required = Array.isArray(json.error?.requiredMigrations) ? `（所需迁移：${json.error.requiredMigrations.join('、')}）` : '';
        throw new Error(`${json.error?.message || '审计日志加载失败'}${required}`);
      }
      setAuditLogs(json.data || []);
      setAuditTotal(Number(json.meta?.total || 0));
    } catch (error) {
      console.error('Failed to fetch audit logs:', error);
      setAuditError(error instanceof Error ? error.message : '审计日志加载失败');
      setAuditLogs([]);
      setAuditTotal(0);
    } finally {
      setAuditLoading(false);
    }
  }, [auditAction, auditPage, auditResourceType]);

  useEffect(() => {
    if (canReadDashboard && (activeTab === 'analytics' || activeTab === 'overview')) void fetchAnalytics();
  }, [activeTab, analyticsRange, canReadDashboard]);

  useEffect(() => {
    if (canReadDashboard && activeTab === 'prefill-quality') void fetchPrefillQuality();
  }, [activeTab, canReadDashboard, fetchPrefillQuality]);

  useEffect(() => {
    if (canReadDashboard && activeTab === 'service-health') void fetchServiceHealth();
  }, [activeTab, canReadDashboard, fetchServiceHealth]);

  useEffect(() => {
    if (canWriteConfig && activeTab === 'logos') void fetchLogos();
  }, [activeTab, canWriteConfig]);

  useEffect(() => {
    if (canReadDashboard && activeTab === 'ai-usage') void fetchAiUsage();
  }, [activeTab, canReadDashboard, fetchAiUsage]);

  useEffect(() => {
    if (canReadUsers && activeTab === 'ai-usage') void fetchAiUsageStudents();
  }, [activeTab, canReadUsers, fetchAiUsageStudents]);

  useEffect(() => {
    if (canWriteConfig && activeTab === 'ai-usage') void fetchAiModelPrices();
  }, [activeTab, canWriteConfig, fetchAiModelPrices]);

  useEffect(() => {
    if (canReadAudit && activeTab === 'audit') void fetchAuditLogs();
  }, [activeTab, canReadAudit, fetchAuditLogs]);

  useEffect(() => {
    setAiUsagePage(1);
    setAiUsageStudentPage(1);
  }, [aiUsageRange, aiUsageFeature, aiUsageProvider, aiUsageStatus, aiUsageSource]);

  useEffect(() => {
    setAuditPage(1);
  }, [auditAction, auditResourceType]);


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
      const response = await fetch(`/api/configs?id=${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '删除配置失败');
      setConfigs(prev => ({
        ...prev,
        [type]: prev[type].filter(c => c.id !== id),
      }));
    } catch (error) {
      console.error('Failed to delete config:', error);
      alert(error instanceof Error ? error.message : '删除配置失败');
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
        setCompanyForm({ 
          company_name: '', 
          short_desc: '',
          full_desc: '',
          industry: '',
          headquarters: '',
          founded_year: '',
          employees: '',
          careers_page: '',
          logo_url: '',
        });
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
      short_desc: (company as { short_desc?: string }).short_desc || '',
      full_desc: (company as { full_desc?: string }).full_desc || '',
      industry: (company as { industry?: string }).industry || '',
      headquarters: (company as { headquarters?: string }).headquarters || '',
      founded_year: (company as { founded_year?: string }).founded_year || '',
      employees: (company as { employees?: string }).employees || '',
      careers_page: (company as { careers_page?: string }).careers_page || '',
      logo_url: company.logo_url || '',
    });
    setCompanyDialogOpen(true);
  };

  const handleDeleteCompany = async (id: number) => {
    if (!confirm('确定要删除这家企业吗？')) return;
    try {
      const response = await fetch(`/api/admin/company-config?id=${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '删除企业失败');
      setCompanies(prev => prev.filter(c => c.id !== id));
    } catch (error) {
      console.error('Failed to delete company:', error);
      alert(error instanceof Error ? error.message : '删除企业失败');
    }
  };

  // Job CRUD
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

  const handleFeedSync = async (mode: 'incremental' | 'reconcile' = 'incremental') => {
    setFeedSyncing(true);
    setFeedSyncMessage(mode === 'reconcile' ? '正在执行完整岗位对账…' : '正在同步招聘数据…');
    try {
      const response = await fetch('/api/jobs/sync-feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, maxPages: mode === 'reconcile' ? 100 : 20 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '同步失败');
      const result = data.result;
      const skippedReasons = Object.entries(result.skipped_by_reason || {})
        .map(([reason, count]) => `${reason}: ${count}`)
        .join('，');
      setFeedSyncMessage(
        `${mode === 'reconcile' ? '对账' : '同步'}完成：接收 ${result.received} 条，写入 ${result.upserted} 条，关闭 ${result.closed} 条。${result.skipped ? `跳过 ${result.skipped} 条（${skippedReasons || '见日志'}）。` : ''}${result.has_more ? '仍有剩余数据，请再次执行。' : '已完成。'}`,
      );
      await fetchJobsPage();
      await fetchJobFeedState();
    } catch (error) {
      setFeedSyncMessage(error instanceof Error ? error.message : '同步失败，请稍后重试');
    } finally {
      setFeedSyncing(false);
    }
  };

  // 文件上传处理
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
        await fetchApplicationsPage();
        setEditingApp(null);
        setAppDialogOpen(false);
      }
    } catch (error) {
      console.error('Failed to update application:', error);
    }
  };

  const handleDeleteResume = async (id: number) => {
    try {
      const response = await fetch(`/api/resume/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '删除简历失败');
      await fetchResumesPage();
    } catch (error) {
      console.error('Failed to delete resume:', error);
      alert(error instanceof Error ? error.message : '删除简历失败');
    }
  };

  // Stats
  const stats = {
    totalJobs: analytics?.overview.totalJobs ?? jobsTotal,
    totalResumes: analytics?.overview.totalResumes ?? resumeSummary.total,
    totalApplications: analytics?.overview.totalApplications ?? applicationSummary.total,
    pendingApps: analytics?.charts.applicationsByStatus.pending ?? applicationSummary.byStatus.pending ?? 0,
    fillingApps: analytics?.charts.applicationsByStatus.filling ?? applicationSummary.byStatus.filling ?? 0,
    submittedApps: analytics?.charts.applicationsByStatus.submitted ?? applicationSummary.byStatus.submitted ?? 0,
    closedApps: analytics?.charts.applicationsByStatus.closed ?? applicationSummary.byStatus.closed ?? 0,
  };

  const filteredJobs = [...jobs].sort((a, b) => {
      // 首先按投递状态排序：可投递排在前面
      const aActive = a.is_active !== false;
      const bActive = b.is_active !== false;
      if (aActive !== bActive) {
        return aActive ? -1 : 1;
      }
      // 然后按创建时间排序：最新排在前面
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const filteredCompanyLogos = companyLogos.filter((logo) =>
    !logoSearch.trim() || logo.company_name.toLowerCase().includes(logoSearch.trim().toLowerCase()),
  );
  const uploadedLogoCount = companyLogos.filter((logo) => logo.source === 'uploaded').length;
  const importedLogoCount = companyLogos.filter((logo) => logo.source === 'imported').length;
  const configuredLogoCount = companyLogos.filter((logo) => logo.source === 'configured').length;
  const automaticLogoCount = companyLogos.filter((logo) => logo.source === 'automatic').length;

  return (
      <div className="min-h-screen bg-background">
        <Dialog open={aiPriceDialogOpen} onOpenChange={setAiPriceDialogOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>添加模型价格</DialogTitle>
              <DialogDescription>同一模型只能采用 Token、音频秒或自定义计费单位的一种口径。</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2 sm:grid-cols-2">
              <div><Label>供应商</Label><Input value={aiPriceForm.provider} onChange={(event) => setAiPriceForm((form) => ({ ...form, provider: event.target.value }))} placeholder="alibaba / cartesia" /></div>
              <div><Label>模型</Label><Input value={aiPriceForm.model} onChange={(event) => setAiPriceForm((form) => ({ ...form, model: event.target.value }))} placeholder="qwen3.7-plus" /></div>
              <div><Label>币种</Label><Input value={aiPriceForm.currency} maxLength={3} onChange={(event) => setAiPriceForm((form) => ({ ...form, currency: event.target.value.toUpperCase() }))} placeholder="USD" /></div>
              <div><Label>生效时间（可选）</Label><Input type="datetime-local" value={aiPriceForm.effectiveFrom} onChange={(event) => setAiPriceForm((form) => ({ ...form, effectiveFrom: event.target.value }))} /></div>
              <div><Label>输入单价 / 百万 Token</Label><Input inputMode="decimal" value={aiPriceForm.inputTokenPricePerMillion} onChange={(event) => setAiPriceForm((form) => ({ ...form, inputTokenPricePerMillion: event.target.value }))} placeholder="仅文本模型" /></div>
              <div><Label>输出单价 / 百万 Token</Label><Input inputMode="decimal" value={aiPriceForm.outputTokenPricePerMillion} onChange={(event) => setAiPriceForm((form) => ({ ...form, outputTokenPricePerMillion: event.target.value }))} placeholder="仅文本模型" /></div>
              <div><Label>音频单价 / 秒</Label><Input inputMode="decimal" value={aiPriceForm.audioSecondPrice} onChange={(event) => setAiPriceForm((form) => ({ ...form, audioSecondPrice: event.target.value }))} placeholder="仅音频模型" /></div>
              <div><Label>自定义单价 / 单位</Label><Input inputMode="decimal" value={aiPriceForm.billingUnitPrice} onChange={(event) => setAiPriceForm((form) => ({ ...form, billingUnitPrice: event.target.value }))} placeholder="仅特殊计费模型" /></div>
              <div className="sm:col-span-2"><Label>备注</Label><Textarea value={aiPriceForm.notes} onChange={(event) => setAiPriceForm((form) => ({ ...form, notes: event.target.value }))} placeholder="价格来源、合同或版本说明" /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAiPriceDialogOpen(false)} disabled={aiPriceSaving}>取消</Button>
              <Button onClick={() => void handleCreateAiPrice()} disabled={aiPriceSaving || !aiPriceForm.provider.trim() || !aiPriceForm.model.trim()}>
                {aiPriceSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}保存价格
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {/* Secondary settings toolbar; navigation and session controls live in AdminShell. */}
        <div className="sticky top-16 z-30 border-b border-zinc-200 bg-background/95 backdrop-blur dark:border-zinc-800">
          <div className="mx-auto flex min-h-12 max-w-7xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">{adminTabMeta[activeTab].title}</h1>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">{adminTabMeta[activeTab].description}</p>
            </div>
            <div className="flex items-center gap-1 md:gap-2">
              {workspaceTabs.find((workspace) => workspace.tabs.includes(activeTab))?.tabs.map((tab) => {
                const meta = adminTabMeta[tab];
                const allowed = availableTabs.some((item) => item.value === tab);
                if (!allowed) return null;
                return <Button key={tab} variant={tab === activeTab ? 'secondary' : 'ghost'} size="sm" className="hidden h-8 px-2 text-xs text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 sm:inline-flex" onClick={() => router.push(`/admin?tab=${tab}`)}>{meta.title.replace('岗位管理', '岗位')}</Button>;
              })}
              {canWriteConfig && <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
                <DialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 md:w-auto md:px-3">
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
                        autoComplete="current-password"
                        value={oldPassword}
                        onChange={(e) => setOldPassword(e.target.value)}
                        placeholder="请输入原密码"
                      />
                    </div>
                    <div>
                      <Label>新密码</Label>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="请输入新密码（至少12位）"
                      />
                    </div>
                    <div>
                      <Label>确认新密码</Label>
                      <Input
                        type="password"
                        autoComplete="new-password"
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
              </Dialog>}
            </div>
          </div>
        </div>

        <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 md:py-8">
        {loading || permissionsLoading ? (
          <div className="text-center py-12">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="mt-2 text-muted-foreground">加载中...</p>
          </div>
        ) : (
          <Tabs value={activeTab} className="space-y-4 md:space-y-6">

            {/* Overview Tab */}
            <TabsContent value="overview">
              <div className="grid gap-4 md:gap-6">
                {/* Stats Cards - 手机端横向滚动 */}
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 md:grid md:grid-cols-4 lg:grid-cols-8 md:gap-4 md:overflow-visible">
                  <Card className="flex-shrink-0 w-28 md:w-auto">
                    <CardContent className="pt-4 md:pt-6 pb-3 md:pb-6 text-center">
                      <div className="flex items-center justify-center gap-1 md:gap-2">
                        <Briefcase className="h-4 w-4 md:h-5 md:w-5 text-blue-600" />
                        <span className="text-xl md:text-2xl font-bold">{stats.totalJobs}</span>
                      </div>
                      <p className="text-xs md:text-sm text-muted-foreground mt-1">当前可投递岗位</p>
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
                        <Send className="h-4 w-4 md:h-5 md:w-5 text-terracotta-600" />
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
                        <Pencil className="h-4 w-4 md:h-5 md:w-5 text-amber-600" />
                        <span className="text-xl md:text-2xl font-bold">{stats.fillingApps}</span>
                      </div>
                      <p className="text-xs md:text-sm text-muted-foreground mt-1">填写中</p>
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
                        <Archive className="h-4 w-4 md:h-5 md:w-5 text-zinc-500" />
                        <span className="text-xl md:text-2xl font-bold">{stats.closedApps}</span>
                      </div>
                      <p className="text-xs md:text-sm text-muted-foreground mt-1">已关闭</p>
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
                ) : analyticsError ? (
                  <div className="rounded-lg border border-dashed p-10 text-center">
                    <p className="text-sm text-destructive">{analyticsError}</p>
                    <Button className="mt-4" variant="outline" onClick={() => void fetchAnalytics()}>重试</Button>
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
                              <span className="text-lg md:text-2xl font-bold">{analytics.overview.recentUsers}</span>
                              <span className="text-xs md:text-sm text-muted-foreground">/{analytics.overview.totalUsers}</span>
                            </div>
                          </div>
                          <p className="text-xs md:text-sm text-muted-foreground mt-1">新增/总用户</p>
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
                            <FileText className="h-4 w-4 md:h-5 md:w-5 text-terracotta-600" />
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
                            <span className="text-xs md:text-sm text-muted-foreground">/{analytics.overview.totalAiMatches}</span>
                          </div>
                          <p className="text-xs md:text-sm text-muted-foreground mt-1">AI选岗次数</p>
                        </CardContent>
                      </Card>
                      <Card className="flex-shrink-0 w-32 md:w-auto">
                        <CardContent className="pt-4 md:pt-6 pb-3 md:pb-6">
                          <div className="flex items-center gap-1 md:gap-2">
                            <TrendingUp className="h-4 w-4 md:h-5 md:w-5 text-emerald-600" />
                            <span className="text-lg md:text-2xl font-bold">
                              {analytics.overview.averageActivityPerActiveUser}
                            </span>
                          </div>
                          <p className="text-xs md:text-sm text-muted-foreground mt-1">活跃学生平均操作</p>
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
                                        className="h-full bg-terracotta-500 rounded-full transition-all"
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
                            范围内网申状态
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
                                  filling: 'bg-amber-400',
                                  submitted: 'bg-blue-500',
                                  closed: 'bg-zinc-500',
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
                                    className="w-3 bg-terracotta-500 rounded-t transition-all"
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
                            <div className="w-3 h-3 bg-terracotta-500 rounded" />
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
                                <tr key={user.userId} className="border-b last:border-0">
                                  <td className="py-3 px-2">
                                    <div className="flex items-center gap-2">
                                      {index < 3 && (
                                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs text-white ${
                                          index === 0 ? 'bg-yellow-500' : index === 1 ? 'bg-gray-400' : 'bg-amber-600'
                                        }`}>
                                          {index + 1}
                                        </span>
                                      )}
                                      <span>{user.userName}</span>
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

            <TabsContent value="service-health">
              <div className="space-y-4 md:space-y-6">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">调用窗口：</span>
                  {(['24h', '7d', '30d'] as const).map((range) => (
                    <Button
                      key={range}
                      variant={serviceHealthRange === range ? 'default' : 'outline'}
                      size="sm"
                      className="h-8 px-3 text-xs"
                      onClick={() => setServiceHealthRange(range)}
                    >
                      {range === '24h' ? '近 24 小时' : range === '7d' ? '近 7 天' : '近 30 天'}
                    </Button>
                  ))}
                  <Button variant="outline" size="sm" className="ml-auto h-8" onClick={() => void fetchServiceHealth()} disabled={serviceHealthLoading}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${serviceHealthLoading ? 'animate-spin' : ''}`} />刷新
                  </Button>
                </div>

                {serviceHealthLoading ? (
                  <div className="py-12 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" /><p className="mt-2 text-muted-foreground">加载服务健康数据...</p></div>
                ) : serviceHealth ? (
                  <>
                    {(() => {
                      const degradedProviders = serviceHealth.providers.filter((provider) => provider.status === 'degraded');
                      const warningProviders = serviceHealth.providers.filter((provider) => provider.status === 'warning');
                      const staleSyncs = serviceHealth.jobSync.filter((sync) => sync.status === 'stale' || sync.status === 'degraded');
                      const runningSyncs = serviceHealth.jobSync.filter((sync) => sync.status === 'running');
                      const hasIssues = degradedProviders.length > 0 || warningProviders.length > 0 || staleSyncs.length > 0;
                      return (
                        <div className={`border-l-4 px-4 py-3 text-sm ${hasIssues ? 'border-amber-500 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100' : 'border-emerald-500 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100'}`}>
                          {hasIssues ? (
                            <span>需要关注：{degradedProviders.length} 个供应商异常，{warningProviders.length} 个供应商有失败告警，{staleSyncs.length} 个岗位同步异常或滞后。</span>
                          ) : (
                            <span>当前窗口未发现供应商降级或岗位同步滞后。</span>
                          )}
                          {runningSyncs.length > 0 && <span className="ml-2">{runningSyncs.length} 个岗位同步正在运行。</span>}
                        </div>
                      );
                    })()}
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Card><CardContent className="pt-5"><p className="text-2xl font-semibold">{formatTokenCount(serviceHealth.overview.callCount)}</p><p className="mt-1 text-sm text-muted-foreground">记录调用数</p></CardContent></Card>
                      <Card><CardContent className="pt-5"><p className="text-2xl font-semibold">{serviceHealth.overview.callCount > 0 ? ((serviceHealth.overview.successfulCalls / serviceHealth.overview.callCount) * 100).toFixed(1) : '0.0'}%</p><p className="mt-1 text-sm text-muted-foreground">整体成功率</p></CardContent></Card>
                      <Card><CardContent className="pt-5"><p className="text-2xl font-semibold">{formatTokenCount(serviceHealth.overview.failedCalls)}</p><p className="mt-1 text-sm text-muted-foreground">失败调用数</p></CardContent></Card>
                      <Card><CardContent className="pt-5"><p className="text-2xl font-semibold">{formatTokenCount(serviceHealth.overview.providersWithCalls)}</p><p className="mt-1 text-sm text-muted-foreground">有调用的供应商</p></CardContent></Card>
                    </div>

                    <Card>
                      <CardHeader><CardTitle className="text-lg">AI 服务健康</CardTitle><CardDescription>基于已记录调用计算，不会因为打开后台而请求第三方服务。</CardDescription></CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 font-medium">供应商</th><th className="py-2 text-right font-medium">调用</th><th className="py-2 text-right font-medium">成功率</th><th className="py-2 text-right font-medium">平均耗时</th><th className="py-2 font-medium">最近调用</th><th className="py-2 font-medium">状态</th></tr></thead><tbody>
                          {serviceHealth.providers.map((provider) => {
                            const statusLabel = provider.status === 'healthy' ? '正常' : provider.status === 'warning' ? '有告警' : provider.status === 'degraded' ? '异常' : '未知';
                            const statusVariant = provider.status === 'healthy' ? 'secondary' : provider.status === 'warning' ? 'outline' : 'destructive';
                            return <tr key={provider.provider} className="border-b last:border-0"><td className="py-2.5">{provider.provider}</td><td className="py-2.5 text-right">{provider.callCount}</td><td className="py-2.5 text-right">{provider.successRate}%</td><td className="py-2.5 text-right">{provider.averageDurationMs === null ? '-' : `${provider.averageDurationMs} ms`}</td><td className="py-2.5">{provider.lastCallAt ? new Date(provider.lastCallAt).toLocaleString('zh-CN') : '-'}</td><td className="py-2.5"><Badge variant={statusVariant}>{statusLabel}</Badge></td></tr>;
                          })}
                          {serviceHealth.providers.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">当前窗口没有已记录的 AI 调用</td></tr>}
                        </tbody></table></div>
                      </CardContent>
                    </Card>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <Card>
                        <CardHeader><CardTitle className="text-lg">失败热点</CardTitle><CardDescription>按供应商和功能聚合，不展示请求内容或错误正文。</CardDescription></CardHeader>
                        <CardContent><div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 font-medium">供应商</th><th className="py-2 font-medium">功能</th><th className="py-2 text-right font-medium">失败</th><th className="py-2 text-right font-medium">失败率</th></tr></thead><tbody>
                          {serviceHealth.failureHotspots.map((item) => <tr key={`${item.provider}-${item.feature}`} className="border-b last:border-0"><td className="py-2.5">{item.provider}</td><td className="py-2.5">{formatAiFeature(item.feature)}</td><td className="py-2.5 text-right">{item.failedCalls}/{item.callCount}</td><td className="py-2.5 text-right">{item.failureRate}%</td></tr>)}
                          {serviceHealth.failureHotspots.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">当前窗口未记录失败调用</td></tr>}
                        </tbody></table></div></CardContent>
                      </Card>
                      <Card>
                        <CardHeader><CardTitle className="text-lg">岗位同步健康</CardTitle><CardDescription>同步超过 24 小时无成功记录会标记为滞后。</CardDescription></CardHeader>
                        <CardContent><div className="space-y-3">
                          {serviceHealth.jobSync.map((sync) => {
                            const statusLabel = sync.status === 'healthy' ? '正常' : sync.status === 'running' ? '同步中' : sync.status === 'stale' ? '已滞后' : sync.status === 'degraded' ? '异常' : '未知';
                            const statusVariant = sync.status === 'healthy' ? 'secondary' : sync.status === 'running' ? 'outline' : 'destructive';
                            return <div key={sync.sourceSystem} className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"><div><p className="font-medium">{sync.sourceSystem}</p><p className="mt-1 text-xs text-muted-foreground">上次增量成功：{sync.lastIncrementalSuccessAt ? new Date(sync.lastIncrementalSuccessAt).toLocaleString('zh-CN') : '-'}</p><p className="text-xs text-muted-foreground">连续失败：{sync.consecutiveFailures}</p></div><Badge variant={statusVariant}>{statusLabel}</Badge></div>;
                          })}
                          {serviceHealth.jobSync.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">尚未初始化岗位同步状态</p>}
                        </div></CardContent>
                      </Card>
                    </div>
                  </>
                ) : <div className="py-12 text-center text-muted-foreground">{serviceHealthError || '暂无服务健康数据'}</div>}
              </div>
            </TabsContent>

            <TabsContent value="prefill-quality">
              <div className="space-y-4 md:space-y-6">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">时间：</span>
                  {(['7d', '30d', '90d'] as const).map((range) => (
                    <Button
                      key={range}
                      variant={prefillQualityRange === range ? 'default' : 'outline'}
                      size="sm"
                      className="h-8 px-3 text-xs"
                      onClick={() => setPrefillQualityRange(range)}
                    >
                      {range === '7d' ? '近 7 天' : range === '30d' ? '近 30 天' : '近 90 天'}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto h-8"
                    onClick={() => void fetchPrefillQuality()}
                    disabled={prefillQualityLoading}
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${prefillQualityLoading ? 'animate-spin' : ''}`} />刷新
                  </Button>
                </div>

                {prefillQualityLoading ? (
                  <div className="py-12 text-center">
                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                    <p className="mt-2 text-muted-foreground">加载网申预填质量数据...</p>
                  </div>
                ) : prefillQuality ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                      <Card>
                        <CardContent className="pt-5">
                          <p className="text-2xl font-semibold">{prefillQuality.overview.confirmationRate}%</p>
                          <p className="mt-1 text-sm text-muted-foreground">确认率</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-5">
                          <p className="text-2xl font-semibold">{prefillQuality.overview.correctionRate}%</p>
                          <p className="mt-1 text-sm text-muted-foreground">修改率</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-5">
                          <p className="text-2xl font-semibold">{formatTokenCount(prefillQuality.overview.decided)}</p>
                          <p className="mt-1 text-sm text-muted-foreground">已决策字段</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-5">
                          <p className="text-2xl font-semibold">{formatTokenCount(prefillQuality.overview.ignored)}</p>
                          <p className="mt-1 text-sm text-muted-foreground">忽略字段</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-5">
                          <p className="text-2xl font-semibold">{formatTokenCount(prefillQuality.overview.contributingUsers)}</p>
                          <p className="mt-1 text-sm text-muted-foreground">贡献学生数</p>
                        </CardContent>
                      </Card>
                    </div>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">反馈趋势</CardTitle>
                        <CardDescription>确认率和修改率只统计已确认或修改的字段；忽略单独列出。</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="flex h-40 items-end gap-2">
                          {prefillQuality.dailyStats.map((day) => {
                            const maximum = Math.max(
                              ...prefillQuality.dailyStats.map((item) => Math.max(item.confirmed, item.edited, item.ignored)),
                              1,
                            );
                            return (
                              <div key={day.date} className="flex min-w-8 flex-1 flex-col items-center gap-1">
                                <div className="flex h-28 w-full items-end justify-center gap-0.5">
                                  <div className="w-2 rounded-t bg-emerald-500" style={{ height: `${(day.confirmed / maximum) * 100}%`, minHeight: day.confirmed ? '3px' : 0 }} title={`确认: ${day.confirmed}`} />
                                  <div className="w-2 rounded-t bg-amber-500" style={{ height: `${(day.edited / maximum) * 100}%`, minHeight: day.edited ? '3px' : 0 }} title={`修改: ${day.edited}`} />
                                  <div className="w-2 rounded-t bg-zinc-400" style={{ height: `${(day.ignored / maximum) * 100}%`, minHeight: day.ignored ? '3px' : 0 }} title={`忽略: ${day.ignored}`} />
                                </div>
                                <span className="text-xs text-muted-foreground">{new Date(day.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-emerald-500" />确认</span>
                          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-amber-500" />修改</span>
                          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-zinc-400" />忽略</span>
                        </div>
                      </CardContent>
                    </Card>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg">字段高纠错榜</CardTitle>
                          <CardDescription>按站点和字段语义聚合，优先处理修改率高且反馈量足够的映射。</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[520px] text-sm">
                              <thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 font-medium">站点</th><th className="py-2 font-medium">字段</th><th className="py-2 text-right font-medium">反馈</th><th className="py-2 text-right font-medium">修改率</th></tr></thead>
                              <tbody>
                                {prefillQuality.fieldQuality.map((item) => (
                                  <tr key={`${item.domain}-${item.semanticKey}`} className="border-b last:border-0">
                                    <td className="py-2.5">{item.domain}</td><td className="py-2.5 font-mono text-xs">{item.semanticKey}</td><td className="py-2.5 text-right">{item.totalFeedback}</td><td className="py-2.5 text-right">{item.correctionRate}%</td>
                                  </tr>
                                ))}
                                {prefillQuality.fieldQuality.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">当前范围暂无字段反馈</td></tr>}
                              </tbody>
                            </table>
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg">共享模板高纠错榜</CardTitle>
                          <CardDescription>仅显示已启用的平台共享模板，计数为历史累计。</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[560px] text-sm">
                              <thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 font-medium">模板</th><th className="py-2 font-medium">ATS</th><th className="py-2 text-right font-medium">使用</th><th className="py-2 text-right font-medium">纠错率</th></tr></thead>
                              <tbody>
                                {prefillQuality.templateQuality.map((item) => (
                                  <tr key={`${item.domainPattern}-${item.semanticKey}`} className="border-b last:border-0">
                                    <td className="py-2.5"><div>{item.domainPattern}</div><div className="font-mono text-xs text-muted-foreground">{item.semanticKey}</div></td><td className="py-2.5">{item.atsType}</td><td className="py-2.5 text-right">{item.usageCount}</td><td className="py-2.5 text-right">{item.correctionRate}%</td>
                                  </tr>
                                ))}
                                {prefillQuality.templateQuality.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">当前没有可评估的共享模板</td></tr>}
                              </tbody>
                            </table>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </>
                ) : (
                  <div className="py-12 text-center text-muted-foreground">{prefillQualityError || '暂无网申预填质量数据'}</div>
                )}
              </div>
            </TabsContent>

            {/* AI Usage Tab */}
            <TabsContent value="ai-usage">
              <div className="space-y-4 md:space-y-6">
                {canWriteConfig && <Card>
                  <CardHeader className="pb-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <CardTitle className="text-lg">模型价格</CardTitle>
                        <CardDescription>新调用按生效时价格写入成本快照。价格变更请新增记录并停用旧记录。</CardDescription>
                      </div>
                      <Button size="sm" onClick={() => setAiPriceDialogOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />添加价格
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px] text-sm">
                        <thead>
                          <tr className="border-b text-muted-foreground">
                            <th className="py-2 text-left font-medium">供应商 / 模型</th>
                            <th className="py-2 text-left font-medium">价格</th>
                            <th className="py-2 text-left font-medium">生效时间</th>
                            <th className="py-2 text-left font-medium">状态</th>
                            <th className="py-2 text-right font-medium">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {aiModelPrices.map((price) => (
                            <tr key={price.id} className="border-b last:border-0">
                              <td className="py-3">{price.provider} / {price.model}<span className="ml-2 text-xs text-muted-foreground">{price.currency}</span></td>
                              <td className="py-3 text-xs">{formatModelPrice(price)}</td>
                              <td className="py-3 text-xs text-muted-foreground">{new Date(price.effective_from).toLocaleString('zh-CN')}</td>
                              <td className="py-3"><Badge variant={price.is_active ? 'secondary' : 'outline'}>{price.is_active ? '启用' : '已停用'}</Badge></td>
                              <td className="py-3 text-right">
                                <Button variant="outline" size="sm" onClick={() => void handleAiPriceStatus(price)}>
                                  {price.is_active ? '停用' : '启用'}
                                </Button>
                              </td>
                            </tr>
                          ))}
                          {aiModelPrices.length === 0 && (
                            <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">{aiPricesLoading ? '加载中...' : aiPricesError || '尚未配置模型价格，成本会显示为未定价'}</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Activity className="h-5 w-5 text-primary" />
                          AI 用量看板
                        </CardTitle>
                        <CardDescription>
                          按功能和调用状态核算 AI token。未知 token 不会被当作 0 计入。
                        </CardDescription>
                      </div>
                      <div className="flex gap-2">
                        {canExportUsage && <Button variant="outline" size="sm" onClick={() => void handleAiUsageExport()} disabled={aiUsageExporting}>
                          <Download className={`mr-2 h-4 w-4 ${aiUsageExporting ? 'animate-pulse' : ''}`} />导出
                        </Button>}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void Promise.all([fetchAiUsage(), canReadUsers ? fetchAiUsageStudents() : Promise.resolve()])}
                          disabled={aiUsageLoading}
                        >
                          <RefreshCw className={`h-4 w-4 mr-2 ${aiUsageLoading ? 'animate-spin' : ''}`} />
                          刷新
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-muted-foreground">时间：</span>
                      {(['7d', '30d', '90d', 'all'] as const).map((range) => (
                        <Button
                          key={range}
                          variant={aiUsageRange === range ? 'default' : 'outline'}
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => setAiUsageRange(range)}
                        >
                          {range === '7d' ? '近7天' : range === '30d' ? '近30天' : range === '90d' ? '近90天' : '全部'}
                        </Button>
                      ))}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <Label className="text-xs text-muted-foreground">功能</Label>
                        <Select value={aiUsageFeature} onValueChange={setAiUsageFeature}>
                          <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">全部功能</SelectItem>
                            {aiFeatureOptions.map((feature) => (
                              <SelectItem key={feature} value={feature}>{formatAiFeature(feature)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">供应商</Label>
                        <Select value={aiUsageProvider} onValueChange={setAiUsageProvider}>
                          <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">全部供应商</SelectItem>
                            <SelectItem value="alibaba">Alibaba</SelectItem>
                            <SelectItem value="cartesia">Cartesia</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">状态</Label>
                        <Select value={aiUsageStatus} onValueChange={setAiUsageStatus}>
                          <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">全部状态</SelectItem>
                            <SelectItem value="success">成功</SelectItem>
                            <SelectItem value="error">失败</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Token 来源</Label>
                        <Select value={aiUsageSource} onValueChange={setAiUsageSource}>
                          <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">全部来源</SelectItem>
                            <SelectItem value="actual">实际返回</SelectItem>
                            <SelectItem value="estimated">估算</SelectItem>
                            <SelectItem value="unknown">未知</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {aiUsageLoading ? (
                  <div className="text-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                    <p className="mt-2 text-muted-foreground">加载 AI 用量...</p>
                  </div>
                ) : aiUsageError ? (
                  <Card>
                    <CardContent className="py-10 text-center">
                      <XCircle className="h-8 w-8 mx-auto text-destructive" />
                      <p className="mt-2 text-sm text-destructive">{aiUsageError}</p>
                      <Button className="mt-4" variant="outline" onClick={() => void fetchAiUsage()}>重试</Button>
                    </CardContent>
                  </Card>
                ) : aiUsage ? (
                  <>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <Card>
                        <CardContent className="pt-5">
                          <p className="text-xs text-muted-foreground">AI 调用次数</p>
                          <p className="mt-1 text-2xl font-bold">{formatTokenCount(aiUsage.summary.call_count)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">成功 {formatTokenCount(aiUsage.summary.successful_calls)} / 失败 {formatTokenCount(aiUsage.summary.failed_calls)}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-5">
                          <p className="text-xs text-muted-foreground">总 Token</p>
                          <p className="mt-1 text-2xl font-bold">{formatTokenCount(aiUsage.summary.total_tokens)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">输入 {formatTokenCount(aiUsage.summary.input_tokens)}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-5">
                          <p className="text-xs text-muted-foreground">输出 Token</p>
                          <p className="mt-1 text-2xl font-bold">{formatTokenCount(aiUsage.summary.output_tokens)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">实际 {formatTokenCount(aiUsage.summary.actual_calls)} 次</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-5">
                          <p className="text-xs text-muted-foreground">数据可信度</p>
                          <p className="mt-1 text-2xl font-bold">{formatTokenCount(aiUsage.summary.actual_calls)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">估算 {formatTokenCount(aiUsage.summary.estimated_calls)} / 未知 {formatTokenCount(aiUsage.summary.unknown_calls)}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-5">
                          <p className="text-xs text-muted-foreground">预计成本</p>
                          <p className="mt-1 text-lg font-bold" title={formatEstimatedCosts(aiUsage.summary.estimated_costs)}>{formatEstimatedCosts(aiUsage.summary.estimated_costs)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">已定价 {formatTokenCount(aiUsage.summary.priced_calls)} / 未定价 {formatTokenCount(aiUsage.summary.unpriced_calls)}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-5">
                          <p className="text-xs text-muted-foreground">音频调用</p>
                          <p className="mt-1 text-2xl font-bold">{formatTokenCount(aiUsage.summary.audio_calls)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">音频 Token {formatTokenCount(aiUsage.summary.audio_tokens)}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-5">
                          <p className="text-xs text-muted-foreground">ASR 输入</p>
                          <p className="mt-1 text-2xl font-bold">{formatAudioMinutes(aiUsage.summary.input_audio_seconds)} 分钟</p>
                          <p className="mt-1 text-xs text-muted-foreground">{formatAudioBytes(aiUsage.summary.input_audio_bytes)}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-5">
                          <p className="text-xs text-muted-foreground">TTS 输出</p>
                          <p className="mt-1 text-2xl font-bold">{formatAudioMinutes(aiUsage.summary.output_audio_seconds)} 分钟</p>
                          <p className="mt-1 text-xs text-muted-foreground">{formatAudioBytes(aiUsage.summary.output_audio_bytes)}</p>
                        </CardContent>
                      </Card>
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">功能用量分布</CardTitle>
                          <CardDescription>文本显示 Token，音频显示 ASR/TTS 分钟数；成本仅统计已配置价格的调用</CardDescription>
                        </CardHeader>
                        <CardContent>
                          {aiUsage.features.length > 0 ? (
                            <div className="space-y-4">
                              {aiUsage.features.slice(0, 10).map((feature) => {
                                 const maxCalls = Math.max(...aiUsage.features.map((item) => item.call_count), 1);
                                 const percent = Math.max(2, Math.round((feature.call_count / maxCalls) * 100));
                                return (
                                  <div key={feature.feature} className="space-y-1">
                                    <div className="flex items-center justify-between gap-3 text-sm">
                                      <span className="truncate">{formatAiFeature(feature.feature)}</span>
                                       <span className="shrink-0 text-muted-foreground">{feature.audio_calls > 0 ? `${formatAudioMinutes(Number(feature.input_audio_seconds) + Number(feature.output_audio_seconds))} 分钟` : `${formatTokenCount(feature.total_tokens)} tokens`}</span>
                                    </div>
                                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
                                    </div>
                                    <div className="flex justify-between text-xs text-muted-foreground">
                                       <span>{formatTokenCount(feature.call_count)} 次调用，音频 {formatTokenCount(feature.audio_calls)} 次</span>
                                      <span>{formatEstimatedCosts(feature.estimated_costs)}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="py-8 text-center text-sm text-muted-foreground">暂无功能用量数据</p>
                          )}
                        </CardContent>
                      </Card>

                      {canReadUsers && <Card>
                        <CardHeader>
                          <CardTitle className="text-base">学生 AI 用量排行</CardTitle>
                          <CardDescription>共 {formatTokenCount(aiUsageStudentTotal)} 名学生，文本按 Token，音频按分钟</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[760px] text-sm">
                              <thead>
                                <tr className="border-b text-muted-foreground">
                                  <th className="py-2 text-left font-medium">学生</th>
                                   <th className="py-2 text-right font-medium">文本 Token</th>
                                  <th className="py-2 text-right font-medium">音频分钟</th>
                                  <th className="py-2 text-right font-medium">预计成本</th>
                                  <th className="py-2 text-right font-medium">调用</th>
                                  <th className="py-2 text-right font-medium">实际/估算/未知</th>
                                </tr>
                              </thead>
                              <tbody>
                                {aiUsageStudents.map((student, index) => (
                                  <tr key={student.user_id} className="border-b last:border-0">
                                    <td className="max-w-[220px] truncate py-3 pr-3">
                                      <span className="mr-2 text-xs text-muted-foreground">{(aiUsageStudentPage - 1) * aiUsageStudentPageSize + index + 1}</span>
                                      <Link className="hover:text-primary hover:underline" href={`/admin/students/${student.user_id}`} title={student.user_id}>{student.display_name || '未命名用户'}</Link>
                                    </td>
                                     <td className="py-3 text-right font-medium">{formatTokenCount(student.total_tokens)}</td>
                                     <td className="py-3 text-right">ASR {formatAudioMinutes(student.input_audio_seconds)} / TTS {formatAudioMinutes(student.output_audio_seconds)}</td>
                                     <td className="py-3 text-right text-xs" title={`已定价 ${student.priced_calls} / 未定价 ${student.unpriced_calls}`}>{formatEstimatedCosts(student.estimated_costs)}</td>
                                     <td className="py-3 text-right">{formatTokenCount(student.call_count)}</td>
                                    <td className="py-3 text-right text-xs text-muted-foreground">{student.actual_calls}/{student.estimated_calls}/{student.unknown_calls}</td>
                                  </tr>
                                ))}
                                {aiUsageStudents.length === 0 && (
                                   <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">暂无学生用量数据</td></tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                          {aiUsageStudentTotal > aiUsageStudentPageSize && (
                            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                              <span>第 {aiUsageStudentPage} / {Math.ceil(aiUsageStudentTotal / aiUsageStudentPageSize)} 页</span>
                              <div className="flex gap-1">
                                <Button variant="outline" size="icon" className="h-7 w-7" disabled={aiUsageStudentPage <= 1} onClick={() => setAiUsageStudentPage((page) => page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                                <Button variant="outline" size="icon" className="h-7 w-7" disabled={aiUsageStudentPage >= Math.ceil(aiUsageStudentTotal / aiUsageStudentPageSize)} onClick={() => setAiUsageStudentPage((page) => page + 1)}><ChevronRight className="h-4 w-4" /></Button>
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>}
                    </div>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">最近 AI 调用</CardTitle>
                        <CardDescription>当前筛选条件下的最新事件，共 {formatTokenCount(aiUsageTotal)} 条</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[1320px] text-sm">
                            <thead>
                              <tr className="border-b text-muted-foreground">
                                <th className="py-2 text-left font-medium">时间</th>
                                <th className="py-2 text-left font-medium">功能</th>
                                <th className="py-2 text-left font-medium">供应商 / 模型</th>
                                <th className="py-2 text-left font-medium">会话 / 路由</th>
                                <th className="py-2 text-right font-medium">文本 Token</th>
                                <th className="py-2 text-right font-medium">音频</th>
                                <th className="py-2 text-right font-medium">计量来源</th>
                                <th className="py-2 text-right font-medium">预计成本</th>
                                <th className="py-2 text-center font-medium">状态</th>
                                <th className="py-2 text-left font-medium">原因 / metadata</th>
                              </tr>
                            </thead>
                            <tbody>
                              {aiUsage.events.map((event) => (
                                <tr key={event.id} className="border-b last:border-0">
                                  <td className="py-3 pr-3 text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString('zh-CN')}</td>
                                  <td className="py-3">{formatAiFeature(event.feature)}</td>
                                  <td className="py-3 text-xs">{event.provider}{event.model ? ` / ${event.model}` : ''}</td>
                                  <td className="py-3 text-xs">{event.interview_session_id ? `#${event.interview_session_id}` : '非面试'}{event.metadata?.voice_route ? <><br /><span className="text-muted-foreground">{String(event.metadata.voice_route)}</span></> : null}</td>
                                   <td className="py-3 text-right">{formatTokenCount(event.total_tokens)}</td>
                                   <td className="py-3 text-right">{event.modality === 'audio' ? <><span>ASR {formatAudioSeconds(event.input_audio_seconds)}</span><br /><span>TTS {formatAudioSeconds(event.output_audio_seconds)}</span></> : '文本'}</td>
                                   <td className="py-3 text-right text-xs">{event.usage_source === 'actual' ? '实际' : event.usage_source === 'estimated' ? '估算' : '未测量'}<br />{event.measurement_source || '未测量'}</td>
                                   <td className="py-3 text-right text-xs" title={event.cost_source === 'priced' ? `${event.currency} ${event.estimated_cost}` : '该调用尚无有效价格'}>{event.cost_source === 'priced' ? `${event.currency} ${Number(event.estimated_cost || 0).toFixed(4)}` : '未定价'}</td>
                                  <td className="py-3 text-center">
                                    <Badge variant={event.status === 'success' ? 'secondary' : 'destructive'}>
                                      {event.status === 'success' ? '成功' : '失败'}
                                    </Badge>
                                  </td>
                                  <td className="max-w-[300px] py-3 text-xs text-muted-foreground"><div>{event.error_message || (event.status === 'success' ? '完成' : '调用失败')}</div><details className="mt-1"><summary className="cursor-pointer text-primary">查看明细</summary><pre className="mt-1 max-w-[300px] overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-[10px]">{JSON.stringify({ request_id: event.request_id, phase: event.phase, fallback: event.fallback, retry_count: event.retry_count, billing_unit: event.billing_unit, billing_units: event.billing_units, metadata: event.metadata || {} }, null, 2)}</pre></details></td>
                                </tr>
                              ))}
                              {aiUsage.events.length === 0 && (
                                 <tr><td colSpan={10} className="py-8 text-center text-muted-foreground">暂无调用事件</td></tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                        {aiUsageTotal > aiUsagePageSize && (
                          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                            <span>第 {aiUsagePage} / {Math.ceil(aiUsageTotal / aiUsagePageSize)} 页</span>
                            <div className="flex gap-1">
                              <Button variant="outline" size="icon" className="h-7 w-7" disabled={aiUsagePage <= 1} onClick={() => setAiUsagePage((page) => page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                              <Button variant="outline" size="icon" className="h-7 w-7" disabled={aiUsagePage >= Math.ceil(aiUsageTotal / aiUsagePageSize)} onClick={() => setAiUsagePage((page) => page + 1)}><ChevronRight className="h-4 w-4" /></Button>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </>
                ) : (
                  <Card><CardContent className="py-12 text-center text-muted-foreground">暂无 AI 用量数据</CardContent></Card>
                )}
              </div>
            </TabsContent>

            <TabsContent value="job-submissions">
              <Card>
                <CardHeader className="gap-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle className="text-lg">岗位投稿审核</CardTitle>
                      <CardDescription>投稿人联系方式和提交者信息不会在后台列表中显示。批准操作以数据库事务创建岗位并更新审核状态。</CardDescription>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => void fetchJobSubmissions()} disabled={jobSubmissionsLoading}>
                      <RefreshCw className={`mr-2 h-4 w-4 ${jobSubmissionsLoading ? 'animate-spin' : ''}`} />刷新
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      className="sm:max-w-sm"
                      value={jobSubmissionsSearch}
                      onChange={(event) => { setJobSubmissionsSearch(event.target.value); setJobSubmissionsPage(1); }}
                      placeholder="搜索岗位或公司"
                    />
                    <Select value={jobSubmissionsStatus} onValueChange={(value) => { setJobSubmissionsStatus(value); setJobSubmissionsPage(1); }}>
                      <SelectTrigger className="sm:w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">待审核</SelectItem>
                        <SelectItem value="approved">已批准</SelectItem>
                        <SelectItem value="rejected">已拒绝</SelectItem>
                        <SelectItem value="all">全部状态</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent>
                  {jobSubmissionsError ? (
                    <div className="py-10 text-center"><XCircle className="mx-auto h-8 w-8 text-destructive" /><p className="mt-2 text-sm text-destructive">{jobSubmissionsError}</p></div>
                  ) : jobSubmissionsLoading ? (
                    <div className="py-10 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" /><p className="mt-2 text-sm text-muted-foreground">加载岗位投稿...</p></div>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[920px] text-sm">
                          <thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 font-medium">岗位</th><th className="py-2 font-medium">地区 / 方向</th><th className="py-2 font-medium">投稿时间</th><th className="py-2 font-medium">状态</th><th className="py-2 font-medium">审核备注</th><th className="py-2 text-right font-medium">操作</th></tr></thead>
                          <tbody>
                            {jobSubmissions.map((submission) => (
                              <tr key={submission.id} className="border-b last:border-0 align-top">
                                <td className="py-3 pr-3"><p className="font-medium">{submission.title}</p><p className="mt-1 text-xs text-muted-foreground">{submission.company}{submission.job_type ? ` · ${submission.job_type}` : ''}</p>{submission.job_url && <a className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline" href={submission.job_url} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" />岗位链接</a>}</td>
                                <td className="py-3">{submission.region || '未标注'}<span className="text-muted-foreground"> / </span>{submission.direction || '未标注'}</td>
                                <td className="py-3 text-xs text-muted-foreground">{new Date(submission.submitted_at || submission.created_at).toLocaleString('zh-CN')}</td>
                                <td className="py-3"><Badge variant={submission.status === 'approved' ? 'secondary' : submission.status === 'rejected' ? 'destructive' : 'outline'}>{submission.status === 'approved' ? '已批准' : submission.status === 'rejected' ? '已拒绝' : '待审核'}</Badge></td>
                                <td className="max-w-[220px] py-3 text-xs text-muted-foreground">{submission.notes || '-'}</td>
                                <td className="py-3 text-right">
                                  {canWriteJobs && <div className="flex justify-end gap-1">
                                    {submission.status === 'pending' && <>
                                      <Button size="sm" onClick={() => { setReviewingSubmission(submission); setReviewNotes(''); setSubmissionReviewAction('approve'); }}>批准</Button>
                                      <Button size="sm" variant="outline" onClick={() => { setReviewingSubmission(submission); setReviewNotes(''); setSubmissionReviewAction('reject'); }}>拒绝</Button>
                                    </>}
                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" title="删除投稿" onClick={() => void handleJobSubmissionDelete(submission)}><Trash2 className="h-4 w-4" /></Button>
                                  </div>}
                                </td>
                              </tr>
                            ))}
                            {jobSubmissions.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">暂无符合条件的岗位投稿</td></tr>}
                          </tbody>
                        </table>
                      </div>
                      {jobSubmissionsTotal > jobSubmissionsPageSize && <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground"><span>第 {jobSubmissionsPage} / {Math.ceil(jobSubmissionsTotal / jobSubmissionsPageSize)} 页，共 {jobSubmissionsTotal} 条</span><div className="flex gap-1"><Button variant="outline" size="icon" className="h-7 w-7" disabled={jobSubmissionsPage <= 1} onClick={() => setJobSubmissionsPage((page) => page - 1)}><ChevronLeft className="h-4 w-4" /></Button><Button variant="outline" size="icon" className="h-7 w-7" disabled={jobSubmissionsPage >= Math.ceil(jobSubmissionsTotal / jobSubmissionsPageSize)} onClick={() => setJobSubmissionsPage((page) => page + 1)}><ChevronRight className="h-4 w-4" /></Button></div></div>}
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Jobs Tab */}
            <TabsContent value="jobs">
              <Card>
                <CardHeader className="pb-3 md:pb-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base md:text-lg">岗位管理</CardTitle>
                      <CardDescription className="text-xs md:text-sm">{canWriteJobs ? '添加、编辑和删除岗位信息' : '查看当前可投递岗位信息'}</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      {canWriteJobs && <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs md:text-sm"
                          onClick={() => void handleFeedSync()}
                          disabled={feedSyncing}
                        >
                          {feedSyncing ? <Loader2 className="h-4 w-4 animate-spin md:mr-2" /> : <Globe className="h-4 w-4 md:mr-2" />}
                          <span className="hidden md:inline">同步招聘数据</span>
                          <span className="md:hidden">同步</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs md:text-sm"
                          onClick={() => setReconcileConfirmOpen(true)}
                          disabled={feedSyncing}
                        >
                          <RefreshCw className="h-4 w-4 md:mr-2" />
                          <span className="hidden md:inline">完整对账</span>
                          <span className="md:hidden">对账</span>
                        </Button>
                      </>}
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
                  {feedSyncMessage && (
                    <p className="mb-4 text-xs md:text-sm text-muted-foreground">{feedSyncMessage}</p>
                  )}

                  {canWriteJobs && (
                    <div className="mb-4 rounded-lg border bg-muted/20 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">招聘源状态</span>
                          {jobFeedState && <Badge variant={jobFeedState.healthy ? 'secondary' : 'destructive'}>{jobFeedState.healthy ? '正常' : '需处理'}</Badge>}
                          {jobFeedState?.state.lease_owner && <Badge variant="outline">同步中</Badge>}
                        </div>
                        <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => void fetchJobFeedState()} disabled={jobFeedStateLoading}>
                          <RefreshCw className={`mr-2 h-4 w-4 ${jobFeedStateLoading ? 'animate-spin' : ''}`} />刷新状态
                        </Button>
                      </div>
                      {jobFeedStateLoading && !jobFeedState ? (
                        <p className="mt-2 text-xs text-muted-foreground">正在读取同步状态...</p>
                      ) : jobFeedStateError ? (
                        <p className="mt-2 text-xs text-destructive">{jobFeedStateError}</p>
                      ) : jobFeedState ? (
                        <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                          <p>数据源：<span className="text-foreground">{jobFeedState.state.source_system}</span></p>
                          <p>上次增量成功：<span className="text-foreground">{jobFeedState.state.last_incremental_success_at ? new Date(jobFeedState.state.last_incremental_success_at).toLocaleString('zh-CN') : '暂无'}</span></p>
                          <p>上次完整对账：<span className="text-foreground">{jobFeedState.state.last_reconcile_success_at ? new Date(jobFeedState.state.last_reconcile_success_at).toLocaleString('zh-CN') : '暂无'}</span></p>
                          <p>连续失败：<span className={jobFeedState.state.consecutive_failures > 0 ? 'font-medium text-destructive' : 'text-foreground'}>{jobFeedState.state.consecutive_failures}</span></p>
                          {jobFeedState.state.last_error && <p className="sm:col-span-2 lg:col-span-4 break-words text-destructive">最近错误：{jobFeedState.state.last_error}</p>}
                        </div>
                      ) : null}
                    </div>
                  )}

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
            </TabsContent>

            {/* Logos Tab */}
            <TabsContent value="logos">
              <Card>
                <CardHeader className="pb-3 md:pb-6">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle className="text-base md:text-lg">企业图标库</CardTitle>
                      <CardDescription className="text-xs md:text-sm">查看当前岗位使用的图标，并上传自定义图标覆盖自动图标</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" className="h-8 text-xs md:text-sm" onClick={() => void fetchLogos()} disabled={logosLoading}>
                        <RefreshCw className={`h-4 w-4 md:mr-2 ${logosLoading ? 'animate-spin' : ''}`} />
                        <span className="hidden md:inline">刷新</span>
                      </Button>
                      <Button size="sm" className="h-8 text-xs md:text-sm" onClick={() => openLogoEditor()}>
                        <Plus className="h-4 w-4 md:mr-2" />
                        <span className="hidden md:inline">上传图标</span>
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <Input
                      value={logoSearch}
                      onChange={(event) => setLogoSearch(event.target.value)}
                      placeholder="搜索公司名称"
                      className="h-9 w-full sm:max-w-xs"
                    />
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">共 {companyLogos.length} 家</Badge>
                      <Badge variant="outline">自定义 {uploadedLogoCount}</Badge>
                      <Badge variant="outline">已导入 {importedLogoCount}</Badge>
                      <Badge variant="outline">企业配置 {configuredLogoCount}</Badge>
                      <Badge variant="outline">自动 {automaticLogoCount}</Badge>
                    </div>
                  </div>

                  {logosError ? (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-6 text-center text-sm text-destructive">
                      <p>{logosError}</p>
                      <Button variant="outline" size="sm" className="mt-3" onClick={() => void fetchLogos()}>重新加载</Button>
                    </div>
                  ) : logosLoading && companyLogos.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />正在读取当前图标...
                    </div>
                  ) : filteredCompanyLogos.length === 0 ? (
                    <div className="py-12 text-center text-muted-foreground">
                      <ImageIcon className="mx-auto mb-3 h-12 w-12 opacity-50" />
                      <p>{companyLogos.length === 0 ? '暂无公司图标数据' : '没有匹配的公司'}</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
                      {filteredCompanyLogos.map((logo) => (
                        <div
                          key={logo.company_name}
                          role="button"
                          tabIndex={0}
                          onClick={() => openLogoEditor(logo.company_name)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              openLogoEditor(logo.company_name);
                            }
                          }}
                          className="group relative cursor-pointer rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <div className="flex aspect-square items-center justify-center rounded-md bg-white dark:bg-zinc-950">
                            <AdminLogoPreview logo={logo} />
                          </div>
                          <div className="mt-2 min-w-0">
                            <p className="truncate text-center text-sm font-medium" title={logo.company_name}>{logo.company_name}</p>
                            <div className="mt-1 flex items-center justify-center gap-1">
                              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                {logo.source === 'uploaded' ? '自定义' : logo.source === 'imported' ? '已导入' : logo.source === 'configured' ? '企业配置' : '自动'}
                              </Badge>
                              {logo.job_count > 0 && <span className="text-[10px] text-muted-foreground">{logo.job_count} 岗位</span>}
                            </div>
                          </div>
                          {logo.source === 'uploaded' && (
                            <Button
                              variant="destructive"
                              size="sm"
                              aria-label={`删除 ${logo.company_name} 自定义图标`}
                              title="删除自定义图标"
                              className="absolute right-1 top-1 h-7 w-7 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleLogoDelete(logo.company_name);
                              }}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Pencil className="pointer-events-none absolute bottom-2 right-2 h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
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
                  <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                    <div>
                      <CardTitle className="text-base md:text-lg">简历管理</CardTitle>
                      <CardDescription className="text-xs md:text-sm">仅展示安全摘要；完整简历正文不在管理员列表返回</CardDescription>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        value={resumeSearch}
                        onChange={(event) => {
                          setResumeSearch(event.target.value);
                          setResumesPage(1);
                        }}
                        placeholder="搜索文件名、用户 ID 或简历 ID"
                        className="h-8 w-full sm:w-64 text-xs"
                      />
                      <Select value={resumeStatus} onValueChange={(value) => { setResumeStatus(value); setResumesPage(1); }}>
                        <SelectTrigger className="h-8 w-full sm:w-40 text-xs">
                          <SelectValue placeholder="处理状态" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">全部状态</SelectItem>
                          {Object.entries(resumeStatusLabels).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
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
                              {canWriteJobs && <td className="px-3 md:px-4 py-2 md:py-3">
                                <Badge variant={resume.processing_status === 'failed' ? 'destructive' : resume.processing_status === 'ready' ? 'default' : 'secondary'} className="text-xs">
                                  {resumeStatusLabels[resume.processing_status || 'uploaded'] || resume.processing_status || '未知'}
                                </Badge>
                              </td>}
                              <td className="px-3 md:px-4 py-2 md:py-3 text-right">
                                {resume.user_id && <Link href={`/admin/students/${resume.user_id}`} title="查看学生用量详情"><Button size="sm" variant="ghost" className="h-8 w-8 md:w-auto"><Users className="h-4 w-4" /></Button></Link>}
                                {canWriteConfig && <Button
                                  size="sm" 
                                  variant="ghost" 
                                  className="h-8 w-8 md:w-auto text-destructive"
                                  onClick={() => handleDeleteResume(resume.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>}
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
                  {resumesTotal > 0 && (
                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span>共 {resumesTotal} 份，第 {resumesPage} / {Math.ceil(resumesTotal / resumesPageSize)} 页</span>
                      <div className="flex gap-1">
                        <Button variant="outline" size="icon" className="h-7 w-7" disabled={resumesPage <= 1} onClick={() => setResumesPage((page) => page - 1)}>
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="icon" className="h-7 w-7" disabled={resumesPage >= Math.ceil(resumesTotal / resumesPageSize)} onClick={() => setResumesPage((page) => page + 1)}>
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Applications Tab */}
            <TabsContent value="applications">
              <Card>
                <CardHeader className="pb-3 md:pb-6">
                  <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                    <div>
                      <CardTitle className="text-base md:text-lg">网申管理</CardTitle>
                      <CardDescription className="text-xs md:text-sm">服务端分页显示，备注仅保留安全摘要</CardDescription>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        value={applicationSearch}
                        onChange={(event) => {
                          setApplicationSearch(event.target.value);
                          setApplicationsPage(1);
                        }}
                        placeholder="搜索备注、岗位 ID、简历 ID 或用户 ID"
                        className="h-8 w-full sm:w-72 text-xs"
                      />
                      <Select value={applicationStatus} onValueChange={(value) => { setApplicationStatus(value); setApplicationsPage(1); }}>
                        <SelectTrigger className="h-8 w-full sm:w-32 text-xs">
                          <SelectValue placeholder="网申状态" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">全部状态</SelectItem>
                          {Object.entries(statusLabels).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
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
                                <Badge variant={app.status === 'submitted' ? 'default' : app.status === 'closed' ? 'outline' : 'secondary'} className="text-xs">
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
                                {app.user_id && <Link href={`/admin/students/${app.user_id}`} title="查看学生用量详情"><Button size="sm" variant="ghost" className="h-8 w-8 md:w-auto"><Users className="h-4 w-4" /></Button></Link>}
                                {canWriteConfig && <Button
                                  size="sm" 
                                  variant="ghost"
                                  className="h-8 w-8 md:w-auto"
                                  onClick={() => {
                                    setEditingApp(app);
                                    setAppDialogOpen(true);
                                  }}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>}
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
                  {applicationsTotal > 0 && (
                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span>共 {applicationsTotal} 条，第 {applicationsPage} / {Math.ceil(applicationsTotal / applicationsPageSize)} 页</span>
                      <div className="flex gap-1">
                        <Button variant="outline" size="icon" className="h-7 w-7" disabled={applicationsPage <= 1} onClick={() => setApplicationsPage((page) => page - 1)}>
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="icon" className="h-7 w-7" disabled={applicationsPage >= Math.ceil(applicationsTotal / applicationsPageSize)} onClick={() => setApplicationsPage((page) => page + 1)}>
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Audit Logs Tab */}
            <TabsContent value="audit">
              <Card>
                <CardHeader className="pb-3 md:pb-6">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle className="text-base md:text-lg">管理员审计日志</CardTitle>
                      <CardDescription className="text-xs md:text-sm">
                        记录管理员写操作及结果；敏感字段和简历正文不会保存。
                      </CardDescription>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void fetchAuditLogs()}
                      disabled={auditLoading}
                    >
                      <RefreshCw className={`h-4 w-4 mr-2 ${auditLoading ? 'animate-spin' : ''}`} />
                      刷新
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                    <Select value={auditResourceType} onValueChange={setAuditResourceType}>
                      <SelectTrigger className="w-full sm:w-48">
                        <SelectValue placeholder="资源类型" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部资源</SelectItem>
                        <SelectItem value="job">岗位</SelectItem>
                        <SelectItem value="job_config">岗位配置</SelectItem>
                        <SelectItem value="company_config">企业配置</SelectItem>
                        <SelectItem value="company_logo">企业 Logo</SelectItem>
                        <SelectItem value="resume">简历</SelectItem>
                        <SelectItem value="application">网申</SelectItem>
                        <SelectItem value="company_dna">企业 DNA</SelectItem>
                        <SelectItem value="interview_feedback">面试反馈</SelectItem>
                        <SelectItem value="job_feed">岗位同步</SelectItem>
                        <SelectItem value="admin_password">管理员密码</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={auditAction} onValueChange={setAuditAction}>
                      <SelectTrigger className="w-full sm:w-56">
                        <SelectValue placeholder="操作类型" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部操作</SelectItem>
                        <SelectItem value="job.create">创建岗位</SelectItem>
                        <SelectItem value="job.update">编辑岗位</SelectItem>
                        <SelectItem value="job.delete">删除岗位</SelectItem>
                        <SelectItem value="job.batch_create">批量导入岗位</SelectItem>
                        <SelectItem value="job.batch_delete">批量删除岗位</SelectItem>
                        <SelectItem value="config.create">创建配置</SelectItem>
                        <SelectItem value="config.update">更新配置</SelectItem>
                        <SelectItem value="config.delete">删除配置</SelectItem>
                        <SelectItem value="resume.delete">删除简历</SelectItem>
                        <SelectItem value="application.update">更新网申</SelectItem>
                        <SelectItem value="application.delete">删除网申</SelectItem>
                        <SelectItem value="company_dna.update">更新企业 DNA</SelectItem>
                        <SelectItem value="dna_feedback.review">审核面试反馈</SelectItem>
                        <SelectItem value="job_feed.sync">同步岗位数据</SelectItem>
                        <SelectItem value="admin_password.change">修改管理员密码</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent>
                  {auditError && <p className="mb-3 text-sm text-destructive">{auditError}</p>}
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full min-w-[1000px] text-sm">
                      <thead className="bg-muted/50">
                        <tr className="border-b">
                          <th className="px-3 py-2 text-left font-medium">时间</th>
                          <th className="px-3 py-2 text-left font-medium">操作</th>
                          <th className="px-3 py-2 text-left font-medium">资源</th>
                          <th className="px-3 py-2 text-left font-medium">学生</th>
                          <th className="px-3 py-2 text-left font-medium">结果</th>
                          <th className="px-3 py-2 text-left font-medium">审计摘要</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLogs.map((log) => (
                          <tr key={log.id} className="border-b last:border-0">
                            <td className="whitespace-nowrap px-3 py-3 text-xs text-muted-foreground">
                              {new Date(log.created_at).toLocaleString('zh-CN')}
                            </td>
                            <td className="px-3 py-3 font-medium">{log.action}</td>
                            <td className="px-3 py-3 text-xs">
                              {log.resource_type}{log.resource_id ? ` #${log.resource_id}` : ''}
                            </td>
                            <td className="px-3 py-3 text-xs text-muted-foreground">
                              {log.subject_user_id ? `${log.subject_user_id.slice(0, 8)}...` : '-'}
                            </td>
                            <td className="px-3 py-3">
                              <Badge variant={log.success ? 'secondary' : 'destructive'}>
                                {log.success ? '成功' : '失败'}
                              </Badge>
                            </td>
                            <td className="max-w-[420px] truncate px-3 py-3 text-xs text-muted-foreground" title={formatAuditPayload(log.after_data || log.metadata)}>
                              {formatAuditPayload(log.after_data || log.metadata)}
                            </td>
                          </tr>
                        ))}
                        {auditLogs.length === 0 && !auditLoading && (
                          <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">暂无审计记录</td></tr>
                        )}
                        {auditLoading && (
                          <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">加载中...</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {auditTotal > auditPageSize && (
                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span>共 {auditTotal} 条，第 {auditPage} / {Math.ceil(auditTotal / auditPageSize)} 页</span>
                      <div className="flex gap-1">
                        <Button variant="outline" size="icon" className="h-7 w-7" disabled={auditPage <= 1} onClick={() => setAuditPage((page) => page - 1)}>
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="icon" className="h-7 w-7" disabled={auditPage >= Math.ceil(auditTotal / auditPageSize)} onClick={() => setAuditPage((page) => page + 1)}>
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
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
                      <CardDescription className="text-xs md:text-sm">管理公司基本信息，岗位自动关联</CardDescription>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditingCompany(null);
                        setCompanyForm({ 
                          company_name: '', 
                          short_desc: '',
                          full_desc: '',
                          industry: '',
                          headquarters: '',
                          founded_year: '',
                          employees: '',
                          careers_page: '',
                          logo_url: '',
                        });
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
                                  {company.careers_page ? (
                                    <a 
                                      href={company.careers_page} 
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

      <AlertDialog open={reconcileConfirmOpen} onOpenChange={(open) => {
        if (!feedSyncing) setReconcileConfirmOpen(open);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认执行完整岗位对账</AlertDialogTitle>
            <AlertDialogDescription>
              完整对账会逐页读取招聘源，并可能将源中已经消失的岗位标记为关闭。任务可以分批续跑，确定现在开始吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={feedSyncing}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={feedSyncing}
              onClick={(event) => {
                event.preventDefault();
                setReconcileConfirmOpen(false);
                void handleFeedSync('reconcile');
              }}
            >
              开始对账
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!reviewingSubmission} onOpenChange={(open) => {
        if (!open && !submissionReviewSaving) {
          setReviewingSubmission(null);
          setReviewNotes('');
          setSubmissionReviewAction(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{submissionReviewAction === 'approve' ? '批准岗位投稿' : '拒绝岗位投稿'}</DialogTitle>
            <DialogDescription>
              {reviewingSubmission ? `${reviewingSubmission.company} - ${reviewingSubmission.title}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="job-submission-review-notes">审核备注（可选）</Label>
            <Textarea
              id="job-submission-review-notes"
              value={reviewNotes}
              maxLength={2000}
              onChange={(event) => setReviewNotes(event.target.value)}
              placeholder={submissionReviewAction === 'approve' ? '可记录审核说明' : '可说明拒绝原因'}
            />
            {submissionReviewAction === 'approve' && <p className="text-xs text-muted-foreground">确认后会原子地创建正式岗位并将投稿标记为已批准。</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={submissionReviewSaving} onClick={() => { setReviewingSubmission(null); setReviewNotes(''); setSubmissionReviewAction(null); }}>取消</Button>
            <Button variant={submissionReviewAction === 'reject' ? 'destructive' : 'default'} disabled={submissionReviewSaving} onClick={() => void handleJobSubmissionReview()}>
              {submissionReviewSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {submissionReviewAction === 'approve' ? '确认批准' : '确认拒绝'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingCompany ? '编辑企业' : '添加企业'}
            </DialogTitle>
            <DialogDescription>
              配置企业信息，公司信息独立维护，岗位自动关联
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>公司名称 *</Label>
                <Input
                  value={companyForm.company_name}
                  onChange={(e) => setCompanyForm({ ...companyForm, company_name: e.target.value })}
                  placeholder="如：Amazon"
                  disabled={!!editingCompany}
                />
              </div>
              <div>
                <Label>总部</Label>
                <Input
                  value={companyForm.headquarters}
                  onChange={(e) => setCompanyForm({ ...companyForm, headquarters: e.target.value })}
                  placeholder="如：美国西雅图"
                />
              </div>
            </div>
            
            <div>
              <Label>一句话简介</Label>
              <Input
                value={companyForm.short_desc}
                onChange={(e) => setCompanyForm({ ...companyForm, short_desc: e.target.value })}
                placeholder="如：全球云计算和电商巨头，正全面转向AI优先"
              />
            </div>
            
            <div>
              <Label>公司介绍</Label>
              <Textarea
                value={companyForm.full_desc}
                onChange={(e) => setCompanyForm({ ...companyForm, full_desc: e.target.value })}
                placeholder="详细介绍公司背景、业务、文化等..."
                className="min-h-[100px]"
              />
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>行业</Label>
                <Input
                  value={companyForm.industry}
                  onChange={(e) => setCompanyForm({ ...companyForm, industry: e.target.value })}
                  placeholder="如：科技/电商"
                />
              </div>
              <div>
                <Label>成立年份</Label>
                <Input
                  value={companyForm.founded_year}
                  onChange={(e) => setCompanyForm({ ...companyForm, founded_year: e.target.value })}
                  placeholder="如：1994"
                />
              </div>
              <div>
                <Label>员工规模</Label>
                <Input
                  value={companyForm.employees}
                  onChange={(e) => setCompanyForm({ ...companyForm, employees: e.target.value })}
                  placeholder="如：150万+"
                />
              </div>
            </div>
            
            <div>
              <Label>招聘页面</Label>
              <Input
                value={companyForm.careers_page}
                onChange={(e) => setCompanyForm({ ...companyForm, careers_page: e.target.value })}
                placeholder="https://www.amazon.jobs"
              />
            </div>
            
            <div>
              <div className="flex items-center justify-between">
                <Label>Logo</Label>
                {companyLogos.length > 0 && (
                  <Select 
                    value={companyForm.logo_url || '__custom__'} 
                    onValueChange={(value) => {
                      if (value === '__custom__') {
                        setCompanyForm({ ...companyForm, logo_url: '' });
                      } else {
                        setCompanyForm({ ...companyForm, logo_url: value });
                      }
                    }}
                  >
                    <SelectTrigger className="h-7 w-auto text-xs">
                      <SelectValue placeholder="选择已有Logo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__custom__">+ 自定义URL</SelectItem>
                      {companyLogos
                        .filter((logo): logo is CompanyLogoCatalogEntry & { logo_url: string } => Boolean(logo.logo_url))
                        .map(logo => (
                        <SelectItem key={`${logo.company_name}-${logo.source}`} value={logo.logo_url}>
                          <div className="flex items-center gap-2">
                            <img src={logo.logo_url} alt="" className="h-4 w-4 rounded" />
                            {logo.company_name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <Input
                  value={companyForm.logo_url}
                  onChange={(e) => setCompanyForm({ ...companyForm, logo_url: e.target.value })}
                  placeholder="https://example.com/logo.png"
                  className="flex-1"
                />
                {companyForm.logo_url && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => openLogoEditor(companyForm.company_name)}
                    className="px-2"
                  >
                    <Upload className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {companyForm.logo_url && (
                <div className="mt-2 flex items-center gap-2">
                  <img src={companyForm.logo_url} alt="" className="h-8 w-8 rounded border bg-white" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCompanyForm({ ...companyForm, logo_url: '' })}
                  >
                    <X className="h-4 w-4 mr-1" />
                    移除
                  </Button>
                </div>
              )}
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

        <LogoUploadDialog
          open={logoDialogOpen}
          initialCompanyName={logoDialogCompanyName}
          onOpenChange={(open) => {
            setLogoDialogOpen(open);
            if (!open) setLogoDialogCompanyName('');
          }}
          onSuccess={fetchLogos}
        />
      </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <AdminContent />
    </Suspense>
  );
}
