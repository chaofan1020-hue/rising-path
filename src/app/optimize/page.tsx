'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
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
} from '@/components/ui/dialog';
import { 
  Sparkles, 
  FileText, 
  Loader2, 
  CheckCircle, 
  Copy, 
  Download,
  Briefcase,
  Wand2,
  Target,
  AlertCircle,
} from 'lucide-react';
import Link from 'next/link';
import { AccessGuard, useAccessCode } from '@/components/access-guard';

interface Resume {
  id: number;
  file_name: string;
  parsed_content: string;
  user_info: Record<string, unknown>;
}

interface ResumeData {
  name: string;
  contact: {
    email?: string;
    phone?: string;
    location?: string;
    linkedin?: string;
  };
  summary?: string;
  skills?: string[];
  experience?: {
    title: string;
    company: string;
    location?: string;
    period: string;
    highlights: string[];
  }[];
  education?: {
    degree: string;
    school: string;
    major?: string;
    period: string;
    gpa?: string;
  }[];
  projects?: {
    name: string;
    role?: string;
    period?: string;
    description?: string;
    highlights: string[];
  }[];
  certifications?: string[];
}

// 简历预览组件
function ResumePreview({ data }: { data: ResumeData }) {
  return (
    <div className="bg-white text-black p-8 shadow-lg rounded-lg">
      {/* 头部：姓名和联系方式 */}
      <div className="text-center border-b-2 border-gray-800 pb-4 mb-4">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{data.name || '姓名'}</h1>
        <div className="flex flex-wrap justify-center gap-4 text-sm text-gray-600">
          {data.contact?.email && <span>{data.contact.email}</span>}
          {data.contact?.phone && <span>{data.contact.phone}</span>}
          {data.contact?.location && <span>{data.contact.location}</span>}
          {data.contact?.linkedin && <span>{data.contact.linkedin}</span>}
        </div>
      </div>

      {/* 个人简介 */}
      {data.summary && (
        <div className="mb-4">
          <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide border-b border-gray-300 pb-1 mb-2">
            个人简介
          </h2>
          <p className="text-sm text-gray-700 leading-relaxed">{data.summary}</p>
        </div>
      )}

      {/* 技能 */}
      {data.skills && data.skills.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide border-b border-gray-300 pb-1 mb-2">
            专业技能
          </h2>
          <div className="flex flex-wrap gap-2">
            {data.skills.map((skill, index) => (
              <span key={index} className="text-sm bg-gray-100 px-2 py-1 rounded text-gray-700">
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 工作经历 */}
      {data.experience && data.experience.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide border-b border-gray-300 pb-1 mb-2">
            工作经历
          </h2>
          <div className="space-y-3">
            {data.experience.map((exp, index) => (
              <div key={index}>
                <div className="flex justify-between items-start mb-1">
                  <div>
                    <span className="font-semibold text-gray-900">{exp.title}</span>
                    <span className="text-gray-600 mx-2">|</span>
                    <span className="text-gray-700">{exp.company}</span>
                    {exp.location && (
                      <>
                        <span className="text-gray-400 mx-1">·</span>
                        <span className="text-gray-500">{exp.location}</span>
                      </>
                    )}
                  </div>
                  <span className="text-sm text-gray-500 whitespace-nowrap">{exp.period}</span>
                </div>
                <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                  {exp.highlights.map((highlight, i) => (
                    <li key={i}>{highlight}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 教育背景 */}
      {data.education && data.education.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide border-b border-gray-300 pb-1 mb-2">
            教育背景
          </h2>
          <div className="space-y-2">
            {data.education.map((edu, index) => (
              <div key={index} className="flex justify-between items-start">
                <div>
                  <span className="font-semibold text-gray-900">{edu.degree}</span>
                  {edu.major && <span className="text-gray-600 mx-1">in {edu.major}</span>}
                  <span className="text-gray-400 mx-2">|</span>
                  <span className="text-gray-700">{edu.school}</span>
                  {edu.gpa && <span className="text-gray-500 ml-2">GPA: {edu.gpa}</span>}
                </div>
                <span className="text-sm text-gray-500 whitespace-nowrap">{edu.period}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 项目经历 */}
      {data.projects && data.projects.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide border-b border-gray-300 pb-1 mb-2">
            项目经历
          </h2>
          <div className="space-y-3">
            {data.projects.map((project, index) => (
              <div key={index}>
                <div className="flex justify-between items-start mb-1">
                  <div>
                    <span className="font-semibold text-gray-900">{project.name}</span>
                    {project.role && (
                      <>
                        <span className="text-gray-400 mx-2">|</span>
                        <span className="text-gray-700">{project.role}</span>
                      </>
                    )}
                  </div>
                  {project.period && <span className="text-sm text-gray-500 whitespace-nowrap">{project.period}</span>}
                </div>
                {project.description && (
                  <p className="text-sm text-gray-600 mb-1">{project.description}</p>
                )}
                <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                  {project.highlights.map((highlight, i) => (
                    <li key={i}>{highlight}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 证书 */}
      {data.certifications && data.certifications.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide border-b border-gray-300 pb-1 mb-2">
            证书资质
          </h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {data.certifications.map((cert, index) => (
              <span key={index} className="text-sm text-gray-700">
                • {cert}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// 内部组件
function OptimizeContent() {
  const searchParams = useSearchParams();
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<string>('');
  const [targetCompany, setTargetCompany] = useState('');
  const [targetPosition, setTargetPosition] = useState('');
  const [suggestions, setSuggestions] = useState('');
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeProgress, setOptimizeProgress] = useState(0);
  const [optimizedContent, setOptimizedContent] = useState('');
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [originalContent, setOriginalContent] = useState('');
  const [showResult, setShowResult] = useState(false);
  const { accessCodeId } = useAccessCode();

  useEffect(() => {
    if (accessCodeId) {
      fetchResumes();
    }
  }, [accessCodeId]);

  // 从URL参数读取预填充数据
  useEffect(() => {
    const resumeIdParam = searchParams.get('resumeId');
    const companyParam = searchParams.get('company');
    const positionParam = searchParams.get('position');
    const suggestionsParam = searchParams.get('suggestions');
    
    if (resumeIdParam) setSelectedResumeId(resumeIdParam);
    if (companyParam) setTargetCompany(companyParam);
    if (positionParam) setTargetPosition(positionParam);
    if (suggestionsParam) setSuggestions(suggestionsParam);
  }, [searchParams]);

  const fetchResumes = async () => {
    if (!accessCodeId) return;
    try {
      const params = new URLSearchParams();
      params.append('access_code_id', accessCodeId.toString());
      const response = await fetch(`/api/resume?${params.toString()}`);
      const data = await response.json();
      setResumes(data.resumes || []);
    } catch (error) {
      console.error('Failed to fetch resumes:', error);
    }
  };

  const handleOptimize = async () => {
    if (!selectedResumeId || !targetPosition || !accessCodeId) return;

    setOptimizing(true);
    setOptimizeProgress(0);
    setOptimizedContent('');

    try {
      const progressInterval = setInterval(() => {
        setOptimizeProgress((prev) => Math.min(prev + 3, 90));
      }, 100);

      const response = await fetch('/api/ai/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resumeId: selectedResumeId,
          targetCompany,
          targetPosition,
          suggestions,
          accessCodeId,
        }),
      });

      clearInterval(progressInterval);
      setOptimizeProgress(100);

      const data = await response.json();
      setOptimizedContent(data.optimized_content || '');
      setResumeData(data.resume_data || null);
      setOriginalContent(data.original_content || '');
      setShowResult(true);

      setTimeout(() => {
        setOptimizeProgress(0);
      }, 1000);
    } catch (error) {
      console.error('Optimization failed:', error);
    } finally {
      setOptimizing(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(optimizedContent);
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
            <Wand2 className="h-8 w-8 text-orange-600" />
            ATS简历优化
          </h1>
          <p className="text-muted-foreground">
            针对ATS系统优化简历，提高简历通过率和曝光率
          </p>
        </div>

        {/* Optimization Form */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              优化设置
            </CardTitle>
            <CardDescription>
              选择简历并设置目标岗位，AI将针对性优化简历内容
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">选择简历</label>
                <Select value={selectedResumeId} onValueChange={setSelectedResumeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择要优化的简历" />
                  </SelectTrigger>
                  <SelectContent>
                    {resumes.map((resume) => (
                      <SelectItem key={resume.id} value={resume.id.toString()}>
                        {resume.file_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">目标公司（可选）</label>
                <Input
                  placeholder="如：Google, Apple..."
                  value={targetCompany}
                  onChange={(e) => setTargetCompany(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">目标岗位</label>
                <Input
                  placeholder="如：软件工程师..."
                  value={targetPosition}
                  onChange={(e) => setTargetPosition(e.target.value)}
                />
              </div>
            </div>

            <div className="flex gap-4">
              <Button 
                onClick={handleOptimize}
                disabled={!selectedResumeId || !targetPosition || optimizing}
                className="bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700"
              >
                {optimizing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    优化中...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    开始优化
                  </>
                )}
              </Button>
            </div>

            {/* AI匹配优化建议 */}
            {suggestions && (
              <div className="mt-4 p-4 rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800">
                <div className="flex items-start gap-3">
                  <Sparkles className="h-5 w-5 text-purple-600 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <h4 className="font-medium text-purple-700 dark:text-purple-300 mb-2">
                      来自AI智能选岗的优化建议
                    </h4>
                    <p className="text-sm text-purple-600 dark:text-purple-400 whitespace-pre-wrap">
                      {suggestions}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {optimizing && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">AI正在优化简历...</span>
                  <span className="text-sm font-medium">{optimizeProgress}%</span>
                </div>
                <Progress value={optimizeProgress} className="h-2" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Features */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardContent className="pt-6">
              <CheckCircle className="h-10 w-10 text-green-600 mb-4" />
              <h3 className="font-semibold mb-2">关键词优化</h3>
              <p className="text-sm text-muted-foreground">
                自动分析岗位要求，添加关键技能词汇
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <Target className="h-10 w-10 text-blue-600 mb-4" />
              <h3 className="font-semibold mb-2">ATS友好格式</h3>
              <p className="text-sm text-muted-foreground">
                优化简历格式，确保ATS系统正确解析
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <Sparkles className="h-10 w-10 text-purple-600 mb-4" />
              <h3 className="font-semibold mb-2">内容增强</h3>
              <p className="text-sm text-muted-foreground">
                使用专业术语增强简历描述
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Tips */}
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div>
                <h4 className="font-medium mb-2">ATS优化建议</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• 使用标准格式：避免复杂的表格和图片</li>
                  <li>• 关键词匹配：研究目标岗位的JD，使用相同术语</li>
                  <li>• 量化成果：用具体数字展示成就</li>
                  <li>• 清晰结构：使用标准章节标题</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Result Dialog */}
      <Dialog open={showResult} onOpenChange={setShowResult}>
        <DialogContent className="!max-w-none w-[98vw] h-[95vh] overflow-hidden flex flex-col p-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              简历优化完成
            </DialogTitle>
            <DialogDescription>
              AI已根据目标岗位优化了您的简历内容，左侧为原简历，右侧为优化后简历
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mb-2">
            <Button variant="outline" size="sm" onClick={handleCopy}>
              <Copy className="mr-2 h-4 w-4" />
              复制优化内容
            </Button>
            <Button size="sm">
              <Download className="mr-2 h-4 w-4" />
              下载简历
            </Button>
          </div>
          
          {/* 对比视图 */}
          <div className="grid grid-cols-2 gap-6 flex-1 min-h-0">
            {/* 原简历 */}
            <div className="flex flex-col min-h-0">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="h-4 w-4 text-gray-500" />
                <h3 className="font-medium text-gray-600">原简历</h3>
              </div>
              <div className="bg-gray-100 p-3 rounded-lg flex-1 overflow-y-auto">
                <div className="bg-white p-6 shadow rounded-lg text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                  {originalContent}
                </div>
              </div>
            </div>
            
            {/* 优化后简历 */}
            <div className="flex flex-col min-h-0">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-green-600" />
                <h3 className="font-medium text-green-600">优化后简历</h3>
                <Badge variant="secondary" className="ml-1">ATS优化</Badge>
              </div>
              <div className="bg-gray-100 p-3 rounded-lg flex-1 overflow-y-auto">
                {resumeData ? (
                  <ResumePreview data={resumeData} />
                ) : (
                  <div className="bg-white p-6 shadow rounded-lg text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                    {optimizedContent}
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// 主组件
export default function OptimizePage() {
  return (
    <AccessGuard>
      <OptimizeContent />
    </AccessGuard>
  );
}
