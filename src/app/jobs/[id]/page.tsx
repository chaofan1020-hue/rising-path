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
  Building2,
  ExternalLink,
  Clock,
  DollarSign,
  FileText,
  Loader2,
  Send,
  Target,
  CheckCircle,
  Star,
  GraduationCap,
  AlertCircle,
  Calendar,
  ChevronRight,
  ChevronDown,
  Globe,
  AlertTriangle,
} from 'lucide-react';
import Link from 'next/link';
import { AccessGuard, useAccessCode } from '@/components/access-guard';

// 关键词列表
const HIGHLIGHT_KEYWORDS = [
  'Python', 'Java', 'JavaScript', 'TypeScript', 'C++', 'C#', 'Go', 'Rust', 'Ruby', 'PHP', 'Swift', 'Kotlin', 'Scala',
  'AWS', 'Azure', 'GCP', 'Google Cloud', 'Amazon Web Services',
  'React', 'Vue', 'Angular', 'Node.js', 'Django', 'Flask', 'Spring', 'Next.js',
  'SQL', 'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'DynamoDB', 'Elasticsearch',
  'Docker', 'Kubernetes', 'Kubernetes', 'K8s', 'Terraform', 'Ansible',
  'Machine Learning', 'ML', 'Deep Learning', 'AI', 'NLP', 'Computer Vision',
  'OPT', 'CPT', 'H1B', 'STEM', 'F1', 'New Grad', 'Entry Level', 'Junior',
  'Remote', 'Hybrid', 'Onsite', 'On-site',
  'TensorFlow', 'PyTorch', 'Keras', 'Scikit-learn', 'Pandas', 'NumPy',
  'Git', 'CI/CD', 'Jenkins', 'GitHub Actions', 'GitLab',
  'REST', 'GraphQL', 'gRPC', 'API', 'Microservices',
  'Agile', 'Scrum', 'Kanban', 'Jira',
  'Product Manager', 'PM', 'Project Manager', 'Data Analyst', 'Data Scientist',
  'Finance', 'Investment Banking', 'Consulting', 'Strategy',
];

// 关键词高亮组件
function HighlightedText({ text }: { text: string }) {
  const [highlighted, setHighlighted] = useState<React.ReactNode[]>([]);

  useEffect(() => {
    const processText = () => {
      let result = text;

      // 按长度降序排序，确保长关键词优先匹配
      const sortedKeywords = [...HIGHLIGHT_KEYWORDS].sort((a, b) => b.length - a.length);

      sortedKeywords.forEach(keyword => {
        // 转义正则特殊字符，但保留原始文本用于显示
        const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // 使用动态构造正则，\b 在某些字符前可能不工作
        let regex;
        try {
          // 对于包含特殊正则字符的关键词，不用 \b 边界
          if (/[.*+?^${}()|[\]\\]/.test(keyword)) {
            regex = new RegExp(escapedKeyword, 'gi');
          } else {
            regex = new RegExp(`\\b${keyword}\\b`, 'gi');
          }
          result = result.replace(regex, `__HIGHLIGHT__${keyword}__END__`);
        } catch {
          // 降级处理
          regex = new RegExp(escapedKeyword.replace(/\\\\/g, '\\'), 'gi');
          result = result.replace(regex, `__HIGHLIGHT__${keyword}__END__`);
        }
      });

      const parts = result.split(/(__HIGHLIGHT__|__END__)/);
      const elements: React.ReactNode[] = [];
      let currentKeyword = '';
      let isHighlight = false;

      parts.forEach((part, index) => {
        if (part === '__HIGHLIGHT__') {
          isHighlight = true;
        } else if (part === '__END__') {
          if (currentKeyword) {
            elements.push(
              <span 
                key={`${index}-${currentKeyword}`} 
                className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded-md bg-violet-100 border border-violet-200 text-violet-700 font-medium text-sm"
              >
                {currentKeyword}
              </span>
            );
          }
          currentKeyword = '';
          isHighlight = false;
        } else if (isHighlight) {
          currentKeyword += part;
        } else {
          elements.push(part);
        }
      });

      if (currentKeyword) {
        elements.push(currentKeyword);
      }

      setHighlighted(elements);
    };

    processText();
  }, [text]);

  return <>{highlighted}</>;

  return <>{highlighted}</>;
}

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
  application_deadline?: string;
  job_type?: string;
  // 公司信息
  company_info?: {
    id: number;
    company_name: string;
    careers_page?: string;
    logo_url?: string;
    short_desc?: string;
    full_desc?: string;
    headquarters?: string;
    industry?: string;
  };
}

interface RelatedJob {
  id: number;
  title: string;
  region: string;
}

// Company Logo Component
function CompanyLogo({ company, logoUrl, size = 'md' }: { company: string; logoUrl?: string; size?: 'sm' | 'md' | 'lg' }) {
  const [logoError, setLogoError] = useState(false);
  const [clearbitUrl, setClearbitUrl] = useState<string | null>(null);
  
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
  };

  useEffect(() => {
    if (!logoUrl && company) {
      const domain = company.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .replace(/\s+/g, '');
      setClearbitUrl(`https://logo.clearbit.com/${domain}.com?size=128`);
    }
  }, [company, logoUrl]);

  const logoSource = logoUrl || clearbitUrl;
  
  if (logoSource && !logoError) {
    return (
      <div className={`${sizeClasses[size]} rounded-lg border overflow-hidden bg-white flex-shrink-0`}>
        <img
          src={logoSource}
          alt={`${company} logo`}
          className="w-full h-full object-contain p-1.5"
          onError={() => setLogoError(true)}
        />
      </div>
    );
  }

  const initial = company?.charAt(0)?.toUpperCase() || '?';
  return (
    <div className={`${sizeClasses[size]} rounded-lg border bg-white flex items-center justify-center flex-shrink-0`}>
      <span className={`${size === 'lg' ? 'text-2xl' : 'text-lg'} font-bold text-primary`}>{initial}</span>
    </div>
  );
}

// Badge variants
function InfoBadge({ icon: Icon, children, variant = 'default' }: { icon: any; children: React.ReactNode; variant?: 'default' | 'success' | 'warning' | 'info' }) {
  const variants = {
    default: 'bg-muted text-muted-foreground',
    success: 'bg-green-100 text-green-700 border-green-200',
    warning: 'bg-amber-100 text-amber-700 border-amber-200',
    info: 'bg-blue-100 text-blue-700 border-blue-200',
  };
  
  return (
    <Badge variant="outline" className={`${variants[variant]} rounded-md text-xs md:text-sm font-normal`}>
      <Icon className="h-3 w-3 mr-1" />
      {children}
    </Badge>
  );
}

// 内部组件
function JobDetailContent() {
  const params = useParams();
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [relatedJobs, setRelatedJobs] = useState<RelatedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [showAllResponsibilities, setShowAllResponsibilities] = useState(false);
  const [showAllRequirements, setShowAllRequirements] = useState(false);
  
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
        
        // 获取同公司其他岗位
        if (data.job.company) {
          const relatedRes = await fetch(`/api/jobs?company=${encodeURIComponent(data.job.company)}&limit=5`);
          const relatedData = await relatedRes.json();
          const others = (relatedData.jobs || []).filter((j: Job) => j.id !== data.job.id);
          setRelatedJobs(others.slice(0, 4));
        }
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
        <AlertCircle className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">{error || '岗位不存在'}</p>
        <Button onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回岗位列表
        </Button>
      </div>
    );
  }

  // 计算新鲜度
  const postedDays = Math.floor((Date.now() - new Date(job.created_at).getTime()) / (1000 * 60 * 60 * 24));
  const isNew = postedDays <= 7;
  const isHot = (relatedJobs.length > 3);

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="container mx-auto px-4 py-4 md:py-8 max-w-4xl">
        {/* 返回按钮 */}
        <Button variant="ghost" className="mb-4 h-9 text-sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回岗位列表
        </Button>

        {/* 主卡片 - 核心信息 */}
        <Card className="mb-4">
          <CardContent className="pt-4 md:pt-6">
            {/* Header: Logo + Title */}
            <div className="flex items-start gap-3 md:gap-4 mb-4">
              <CompanyLogo company={job.company} logoUrl={job.logo_url} size="lg" />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <h1 className="text-xl md:text-2xl font-bold mb-1 line-clamp-2">{job.title}</h1>
                    <p className="text-base md:text-lg text-muted-foreground flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      {job.company}
                      {isNew && <Badge className="bg-green-500 text-white text-xs">新发布</Badge>}
                      {isHot && <Badge variant="outline" className="text-orange-600 border-orange-300 text-xs">热招</Badge>}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* 关键信息标签 */}
            <div className="flex flex-wrap gap-2 mb-4">
              <InfoBadge icon={MapPin}>{job.region}</InfoBadge>
              <InfoBadge icon={GraduationCap}>{job.audience || job.job_type || 'Entry-level'}</InfoBadge>
              {job.direction && <InfoBadge icon={Briefcase}>{job.direction}</InfoBadge>}
              {job.salary_range && (
                <InfoBadge icon={DollarSign} variant="success">{job.salary_range}</InfoBadge>
              )}
              {job.sponsorship && job.sponsorship !== 'unknown' && (
                <Badge 
                  className={job.sponsorship === 'yes' 
                    ? 'bg-green-100 text-green-700 border-green-300 hover:bg-green-100 text-xs md:text-sm font-medium px-2 py-1' 
                    : 'bg-red-100 text-red-700 border-red-300 hover:bg-red-100 text-xs md:text-sm font-bold px-2 py-1 animate-pulse'
                  }
                >
                  {job.sponsorship === 'yes' ? (
                    <span className="flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" />
                      可提供Sponsor
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      不提供Sponsor - 不适合留学生
                    </span>
                  )}
                </Badge>
              )}
            </div>

            {/* 截止日期 */}
            {job.application_deadline && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                <Calendar className="h-4 w-4" />
                <span>截止日期：{job.application_deadline}</span>
              </div>
            )}

            <Separator className="my-4" />

            {/* CTA 按钮 */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Button 
                className="bg-green-600 hover:bg-green-700 flex-1"
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
                    <CheckCircle className="h-4 w-4 mr-2" />
                    已投递 (查看进度)
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    去官网申请
                  </>
                )}
              </Button>
              {job.job_url && (
                <Button variant="outline" asChild className="flex-1 sm:flex-none">
                  <a href={job.job_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    原链接
                  </a>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 公司信息卡 */}
        {job.company_info && (
          <Card className="mb-4 bg-gradient-to-r from-slate-50 to-blue-50 border-slate-200">
            <CardContent className="pt-4">
              <div className="flex items-start gap-3">
                <CompanyLogo company={job.company_info.company_name} logoUrl={job.company_info.logo_url} size="md" />
                <div className="flex-1">
                  <h3 className="font-semibold text-base mb-1">{job.company_info.company_name}</h3>
                  {job.company_info.short_desc && (
                    <p className="text-sm text-muted-foreground mb-2">{job.company_info.short_desc}</p>
                  )}
                  {job.company_info.headquarters && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                      <MapPin className="h-3 w-3" />
                      {job.company_info.headquarters}
                    </p>
                  )}
                  {job.company_info.industry && (
                    <p className="text-xs text-muted-foreground mb-2">
                      行业：{job.company_info.industry}
                    </p>
                  )}
                </div>
              </div>
              {job.company_info.full_desc && (
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-black" />
                    公司介绍
                  </h4>
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {job.company_info.full_desc}
                  </p>
                </div>
              )}
              {job.company_info.careers_page && (
                <div className="mt-4">
                  <a 
                    href={job.company_info.careers_page}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-black hover:underline"
                  >
                    <Globe className="h-3 w-3" />
                    查看公司全部职位
                    <ChevronRight className="h-3 w-3" />
                  </a>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 岗位概述 */}
        {job.overview && (
          <Card className="mb-4 bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="h-4 w-4 text-green-600" />
                <span className="font-medium text-sm">岗位概述</span>
              </div>
              <p className="text-sm md:text-base text-foreground leading-relaxed">
                <HighlightedText text={job.overview} />
              </p>
            </CardContent>
          </Card>
        )}

        {/* 岗位职责 */}
        {job.responsibilities && (() => {
          const items = job.responsibilities.split('|').filter((item: string) => item.trim());
          const initialCount = 5;
          const showExpand = items.length > initialCount;
          const displayItems = showExpand && !showAllResponsibilities ? items.slice(0, initialCount) : items;
          
          return (
            <Card className="mb-4">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-green-600" />
                    岗位职责
                    <Badge variant="secondary" className="text-xs ml-1">{items.length}条</Badge>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {displayItems.map((item: string, index: number) => (
                    <li key={index} className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-xs font-medium mt-0.5">
                        {index + 1}
                      </span>
                      <span className="text-sm text-muted-foreground"><HighlightedText text={item.trim()} /></span>
                    </li>
                  ))}
                </ul>
                {showExpand && (
                  <Button 
                    variant="ghost" 
                    className="w-full mt-3 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                    onClick={() => setShowAllResponsibilities(!showAllResponsibilities)}
                  >
                    {showAllResponsibilities ? (
                      <>
                        <ChevronDown className="h-4 w-4 mr-1 rotate-180" />
                        收起
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4 mr-1" />
                        查看全部 {items.length} 条岗位职责
                      </>
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {/* 任职要求 */}
        {job.requirements && (() => {
          const items = job.requirements.split('|').filter((item: string) => item.trim());
          const initialCount = 5;
          const showExpand = items.length > initialCount;
          const displayItems = showExpand && !showAllRequirements ? items.slice(0, initialCount) : items;
          
          return (
            <Card className="mb-4">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-black" />
                    任职要求
                    <Badge variant="secondary" className="text-xs ml-1">{items.length}条</Badge>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {displayItems.map((item: string, index: number) => (
                    <li key={index} className="flex items-start gap-3">
                      <CheckCircle className="h-4 w-4 text-black flex-shrink-0 mt-1" />
                      <span className="text-sm text-muted-foreground"><HighlightedText text={item.trim()} /></span>
                    </li>
                  ))}
                </ul>
                {showExpand && (
                  <Button 
                    variant="ghost" 
                    className="w-full mt-3 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                    onClick={() => setShowAllRequirements(!showAllRequirements)}
                  >
                    {showAllRequirements ? (
                      <>
                        <ChevronDown className="h-4 w-4 mr-1 rotate-180" />
                        收起
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4 mr-1" />
                        查看全部 {items.length} 条任职要求
                      </>
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {/* 加分项 */}
        {job.nice_to_have && (
          <Card className="mb-4 border-amber-200 bg-amber-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base text-amber-800">
                <Star className="h-4 w-4" />
                加分项
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {job.nice_to_have.split('|').filter((item: string) => item.trim()).map((item: string, index: number) => (
                  <li key={index} className="flex items-start gap-3">
                    <Star className="h-4 w-4 text-amber-500 flex-shrink-0 mt-1" />
                    <span className="text-sm text-amber-700">{item.trim()}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* 原始岗位描述 - 如果没有结构化数据 */}
        {!job.overview && job.description && (
          <Card className="mb-4">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                岗位描述
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="whitespace-pre-wrap text-sm text-muted-foreground">
                {job.description}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 同公司其他岗位 - 优先跳转到公司招聘页面 */}
        {(relatedJobs.length > 0 || job.company_info?.careers_page) && (
          <Card className="mb-4">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-black" />
                  同公司其他岗位 {relatedJobs.length > 0 && `(${relatedJobs.length})`}
                </span>
                {job.company_info?.careers_page && (
                  <a 
                    href={job.company_info.careers_page}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-black hover:underline flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Globe className="h-3 w-3" />
                    查看全部职位
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {relatedJobs.length > 0 ? (
                <div className="space-y-2">
                  {relatedJobs.map((relatedJob) => (
                    <Link 
                      key={relatedJob.id}
                      href={`/jobs/${relatedJob.id}`}
                      className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors group"
                    >
                      <div>
                        <p className="font-medium text-sm group-hover:text-blue-600">{relatedJob.title}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <MapPin className="h-3 w-3" />
                          {relatedJob.region}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-blue-600" />
                    </Link>
                  ))}
                </div>
              ) : job.company_info?.careers_page ? (
                <a 
                  href={job.company_info.careers_page}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 p-4 rounded-lg bg-green-50 hover:bg-green-100 transition-colors text-green-700 font-medium"
                >
                  <Globe className="h-5 w-5" />
                  去 {job.company} 官网申请
                  <ExternalLink className="h-4 w-4" />
                </a>
              ) : null}
            </CardContent>
          </Card>
        )}

        {/* 底部信息 */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>发布于 {new Date(job.created_at).toLocaleDateString('zh-CN')}</span>
                <span className="mx-2">·</span>
                <span>{postedDays === 0 ? '今天' : `${postedDays}天前`}</span>
              </div>
              <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                <a href={`/jobs?company=${encodeURIComponent(job.company)}`}>
                  <Briefcase className="h-3 w-3 mr-1" />
                  查看更多{job.company}岗位
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function JobDetailPage() {
  return (
    <AccessGuard>
      <JobDetailContent />
    </AccessGuard>
  );
}
