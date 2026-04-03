'use client';

import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { 
  Upload, 
  FileText, 
  Trash2, 
  Download, 
  Loader2, 
  CheckCircle,
  Briefcase,
  User,
  Calendar,
  Link as LinkIcon,
  Languages,
  Sparkles,
  Map,
} from 'lucide-react';
import Link from 'next/link';
import { AccessGuard, useAccessCode } from '@/components/access-guard';

interface ParsedFields {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  education?: Array<{
    school: string;
    degree: string;
    major: string;
    duration?: string;
    gpa?: string;
  }>;
  experience?: Array<{
    company: string;
    title: string;
    duration?: string;
    highlights?: string[];
  }>;
  skills?: {
    technical?: string[];
    languages?: string[];
    tools?: string[];
  };
  summary?: string;
}

interface Resume {
  id: number;
  file_key: string;
  file_name: string;
  parsed_content: string;
  parsed_fields?: ParsedFields;
  user_info: {
    name?: string;
    email?: string;
    phone?: string;
    education?: string[];
    experience?: string[];
    skills?: string[];
  };
  created_at: string;
}

// 内部组件 - 在 AccessGuard 内部使用 useAccessCode
function ResumeContent() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedResume, setSelectedResume] = useState<Resume | null>(null);
  const [translatingId, setTranslatingId] = useState<number | null>(null);
  const [extractingId, setExtractingId] = useState<number | null>(null);
  const { accessCodeId } = useAccessCode();

  // 提取结构化字段
  const extractFields = async (resume: Resume) => {
    setExtractingId(resume.id);
    try {
      const response = await fetch('/api/resume/extract-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resume_id: resume.id,
          access_code_id: accessCodeId,
        }),
      });

      const data = await response.json();
      if (data.success && data.parsed_fields) {
        setResumes(resumes.map(r => 
          r.id === resume.id ? { ...r, parsed_fields: data.parsed_fields } : r
        ));
        setSelectedResume(prev => prev?.id === resume.id ? { ...prev, parsed_fields: data.parsed_fields } : prev);
        alert('字段提取成功！');
      } else if (data.error) {
        alert('提取失败: ' + data.error);
      }
    } catch (error) {
      console.error('Extract failed:', error);
      alert('提取失败，请重试');
    } finally {
      setExtractingId(null);
    }
  };

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  }, []);

  const handleUpload = async () => {
    if (!selectedFile) return;

    if (!accessCodeId) {
      alert('请先登录');
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('access_code_id', accessCodeId.toString());

      // Simulate progress
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      const response = await fetch('/api/resume', {
        method: 'POST',
        body: formData,
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      const data = await response.json();
      
      if (data.resume) {
        // 等待几秒后刷新列表以获取解析结果
        setTimeout(() => {
          fetchResumes();
        }, 3000);
        setSelectedFile(null);
        setUploadProgress(0);
      } else if (data.error) {
        alert('上传失败: ' + data.error);
      }
    } catch (error) {
      console.error('Upload failed:', error);
      alert('上传失败，请重试');
    } finally {
      setUploading(false);
    }
  };

  const fetchResumes = async () => {
    setLoading(true);
    try {
      if (!accessCodeId) {
        setResumes([]);
        return;
      }
      const params = new URLSearchParams();
      params.append('access_code_id', accessCodeId.toString());
      const response = await fetch(`/api/resume?${params.toString()}`);
      const data = await response.json();
      setResumes(data.resumes || []);
    } catch (error) {
      console.error('Failed to fetch resumes:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteResume = async (id: number) => {
    try {
      await fetch(`/api/resume/${id}`, { method: 'DELETE' });
      setResumes(resumes.filter((r) => r.id !== id));
    } catch (error) {
      console.error('Failed to delete resume:', error);
    }
  };

  const translateResume = async (resume: Resume) => {
    setTranslatingId(resume.id);
    try {
      const response = await fetch('/api/ai/translate-resume-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resumeId: resume.id,
          content: resume.parsed_content,
          userInfo: resume.user_info,
        }),
      });

      const data = await response.json();
      if (data.resume) {
        setResumes(resumes.map(r => 
          r.id === resume.id ? { ...r, ...data.resume } : r
        ));
      }
    } catch (error) {
      console.error('Translation failed:', error);
    } finally {
      setTranslatingId(null);
    }
  };

  // Fetch resumes when accessCodeId changes
  useEffect(() => {
    if (accessCodeId) {
      fetchResumes();
    }
  }, [accessCodeId]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 md:h-6 md:w-6 text-primary" />
            <span className="font-bold text-lg md:text-xl">PathUp</span>
          </Link>
          <nav className="flex items-center gap-2 md:gap-4">
            <Link href="/jobs">
              <Button variant="ghost" size="sm" className="text-xs md:text-sm">岗位查询</Button>
            </Link>
            <Link href="/ai-match">
              <Button size="sm" className="text-xs md:text-sm">AI选岗</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="container mx-auto px-4 py-4 md:py-8">
        {/* Page Title */}
        <div className="mb-4 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-1 md:mb-2">简历管理</h1>
          <p className="text-sm md:text-base text-muted-foreground">上传、管理你的简历，支持智能解析</p>
        </div>

        {/* Upload Section */}
        <Card className="mb-4 md:mb-8">
          <CardHeader className="pb-2 md:pb-4">
            <CardTitle className="flex items-center gap-2 text-base md:text-lg">
              <Upload className="h-4 w-4 md:h-5 md:w-5" />
              上传简历
            </CardTitle>
            <CardDescription className="text-xs md:text-sm">
              支持 PDF、Word (.docx)、TXT 格式，系统将自动解析提取关键信息
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row md:items-end gap-3 md:gap-4">
              <div className="flex-1">
                <Input
                  type="file"
                  accept=".pdf,.doc,.docx,.txt"
                  onChange={handleFileSelect}
                  disabled={uploading}
                  className="text-sm h-10"
                />
                <p className="text-xs text-muted-foreground mt-1 hidden md:block">
                  支持 PDF、Word (.docx)、TXT 格式，系统将自动提取姓名、联系方式、教育经历、工作经验、技能等信息
                </p>
                {selectedFile && (
                  <p className="text-xs md:text-sm text-muted-foreground mt-2">
                    已选择: {selectedFile.name}
                  </p>
                )}
              </div>
              <Button onClick={handleUpload} disabled={!selectedFile || uploading} className="w-full md:w-auto h-10">
                {uploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    上传中...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    上传简历
                  </>
                )}
              </Button>
            </div>
            {uploading && (
              <div className="mt-4">
                <Progress value={uploadProgress} className="h-2" />
                <p className="text-sm text-muted-foreground mt-2 text-center">
                  {uploadProgress < 100 ? '正在上传并解析...' : '上传完成！'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Resume List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg md:text-xl font-semibold">我的简历</h2>
            <Button variant="outline" size="sm" className="text-xs md:text-sm" onClick={fetchResumes}>
              刷新列表
            </Button>
          </div>
          {loading ? (
            <div className="text-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
              加载中...
            </div>
          ) : resumes.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>暂无简历，上传你的第一份简历吧</p>
              </CardContent>
            </Card>
          ) : (
            resumes.map((resume) => (
              <Card key={resume.id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-4 md:pt-6">
                  <div className="flex flex-col gap-4">
                    {/* 文件信息 */}
                    <div className="flex items-start gap-3 md:gap-4">
                      <div className="w-10 h-10 md:w-12 md:h-12 rounded-lg bg-green-100 dark:bg-green-900 flex items-center justify-center flex-shrink-0">
                        <FileText className="h-5 w-5 md:h-6 md:w-6 text-green-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm md:text-lg truncate">{resume.file_name}</h3>
                        <div className="flex flex-wrap gap-1.5 md:gap-2 mt-2">
                          <Badge variant="secondary" className="text-xs">
                            <Calendar className="h-3 w-3 mr-1" />
                            {new Date(resume.created_at).toLocaleDateString()}
                          </Badge>
                          {resume.user_info?.name ? (
                            <Badge variant="outline" className="text-xs">
                              <User className="h-3 w-3 mr-1" />
                              {resume.user_info.name}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-yellow-600">
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              解析中...
                            </Badge>
                          )}
                        </div>
                        {resume.parsed_content && !resume.parsed_content.includes('正在解析') && (
                          <p className="text-xs md:text-sm text-muted-foreground mt-2 line-clamp-2 hidden md:block">
                            {resume.parsed_content.substring(0, 150)}...
                          </p>
                        )}
                      </div>
                    </div>
                    
                    {/* 操作按钮 - 手机端换行显示 */}
                    <div className="flex flex-wrap gap-2 md:gap-2 pl-0 md:pl-[52px]">
                      {resume.parsed_content && !resume.parsed_content.includes('正在解析') && (
                        <Button 
                          variant="outline" 
                          size="sm"
                          className="text-xs h-8"
                          onClick={() => extractFields(resume)}
                          disabled={extractingId === resume.id}
                        >
                          {extractingId === resume.id ? (
                            <>
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              提取中
                            </>
                          ) : resume.parsed_fields ? (
                            <>
                              <CheckCircle className="h-3 w-3 mr-1 text-green-600" />
                              已提取
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-3 w-3 mr-1" />
                              提取字段
                            </>
                          )}
                        </Button>
                      )}
                      <Button 
                        variant="outline" 
                        size="sm"
                        className="text-xs h-8"
                        onClick={() => translateResume(resume)}
                        disabled={translatingId === resume.id}
                      >
                        {translatingId === resume.id ? (
                          <>
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            翻译中
                          </>
                        ) : (
                          <>
                            <Languages className="h-3 w-3 mr-1" />
                            翻译
                          </>
                        )}
                      </Button>
                      <Link href="/field-mappings" className="hidden sm:block">
                        <Button variant="outline" size="sm" className="text-xs h-8">
                          <Map className="h-3 w-3 mr-1" />
                          字段映射
                        </Button>
                      </Link>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button 
                            variant="outline" 
                            size="sm"
                            className="text-xs h-8"
                            onClick={() => setSelectedResume(resume)}
                          >
                            查看详情
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl max-h-[85vh] md:max-h-[80vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle className="text-base md:text-lg truncate pr-6">{resume.file_name}</DialogTitle>
                            <DialogDescription className="text-xs md:text-sm">
                              简历解析结果
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4">
                            {/* 结构化字段 (AI提取) */}
                            {resume.parsed_fields && (
                              <div className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30 p-3 md:p-4 rounded-lg">
                                <div className="flex items-center gap-2 mb-3">
                                  <Sparkles className="h-4 w-4 text-purple-600" />
                                  <h4 className="font-semibold text-sm md:text-base">结构化字段</h4>
                                  <Badge variant="secondary" className="text-xs">AI 提取</Badge>
                                </div>
                                
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                  {resume.parsed_fields.name && (
                                    <div>
                                      <span className="text-muted-foreground">姓名:</span>
                                      <p className="font-medium">{resume.parsed_fields.name}</p>
                                    </div>
                                  )}
                                  {resume.parsed_fields.email && (
                                    <div>
                                      <span className="text-muted-foreground">邮箱:</span>
                                      <p className="font-medium break-all">{resume.parsed_fields.email}</p>
                                    </div>
                                  )}
                                  {resume.parsed_fields.phone && (
                                    <div>
                                      <span className="text-muted-foreground">电话:</span>
                                      <p className="font-medium">{resume.parsed_fields.phone}</p>
                                    </div>
                                  )}
                                  {resume.parsed_fields.location && (
                                    <div>
                                      <span className="text-muted-foreground">地址:</span>
                                      <p className="font-medium">{resume.parsed_fields.location}</p>
                                    </div>
                                  )}
                                </div>

                                {resume.parsed_fields.education && resume.parsed_fields.education.length > 0 && (
                                  <div className="mt-3">
                                    <span className="text-sm text-muted-foreground">教育背景:</span>
                                    <ul className="mt-1 space-y-1">
                                      {resume.parsed_fields.education.map((edu, i) => (
                                        <li key={i} className="text-sm">
                                          <strong>{edu.school}</strong> - {edu.degree} {edu.major}
                                          {edu.duration && <span className="text-muted-foreground"> ({edu.duration})</span>}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                                {resume.parsed_fields.experience && resume.parsed_fields.experience.length > 0 && (
                                  <div className="mt-3">
                                    <span className="text-sm text-muted-foreground">工作经历:</span>
                                    <ul className="mt-1 space-y-2">
                                      {resume.parsed_fields.experience.map((exp, i) => (
                                        <li key={i} className="text-sm">
                                          <strong>{exp.company}</strong> - {exp.title}
                                          {exp.duration && <span className="text-muted-foreground"> ({exp.duration})</span>}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                                {resume.parsed_fields.skills && (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {resume.parsed_fields.skills.technical?.map((skill, i) => (
                                      <Badge key={`tech-${i}`} variant="secondary">{skill}</Badge>
                                    ))}
                                    {resume.parsed_fields.skills.languages?.map((skill, i) => (
                                      <Badge key={`lang-${i}`} variant="outline">{skill}</Badge>
                                    ))}
                                  </div>
                                )}

                                <div className="mt-3 pt-3 border-t">
                                  <Link href="/field-mappings">
                                    <Button variant="outline" size="sm" className="w-full">
                                      <Map className="h-4 w-4 mr-2" />
                                      配置字段映射
                                    </Button>
                                  </Link>
                                </div>
                              </div>
                            )}

                            {/* 原始解析信息 */}
                            {resume.user_info?.name && (
                              <div>
                                <h4 className="font-semibold text-sm md:text-base mb-2">基本信息</h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                                  {resume.user_info.name && <p><strong>姓名:</strong> {resume.user_info.name}</p>}
                                  {resume.user_info.email && <p className="break-all"><strong>邮箱:</strong> {resume.user_info.email}</p>}
                                  {resume.user_info.phone && <p><strong>电话:</strong> {resume.user_info.phone}</p>}
                                </div>
                              </div>
                            )}
                            {resume.user_info?.education && resume.user_info.education.length > 0 && (
                              <div>
                                <h4 className="font-semibold text-sm md:text-base mb-2">教育背景</h4>
                                <ul className="list-disc list-inside text-sm space-y-1">
                                  {resume.user_info.education.map((edu, i) => (
                                    <li key={i}>{edu}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {resume.user_info?.experience && resume.user_info.experience.length > 0 && (
                              <div>
                                <h4 className="font-semibold text-sm md:text-base mb-2">工作经历</h4>
                                <ul className="list-disc list-inside text-sm space-y-1">
                                  {resume.user_info.experience.map((exp, i) => (
                                    <li key={i}>{exp}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {resume.user_info?.skills && resume.user_info.skills.length > 0 && (
                              <div>
                                <h4 className="font-semibold text-sm md:text-base mb-2">技能标签</h4>
                                <div className="flex flex-wrap gap-1.5 md:gap-2">
                                  {resume.user_info.skills.map((skill, i) => (
                                    <Badge key={i} variant="secondary" className="text-xs">{skill}</Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                      <Button 
                        variant="destructive" 
                        size="sm"
                        className="text-xs h-8 px-2"
                        onClick={() => deleteResume(resume.id)}
                      >
                        <Trash2 className="h-3 w-3 md:h-4 md:w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </main>
    </div>
  );
}

// 主组件 - 使用 AccessGuard 包裹内部组件
export default function ResumePage() {
  return (
    <AccessGuard>
      <ResumeContent />
    </AccessGuard>
  );
}
