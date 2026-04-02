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
} from 'lucide-react';
import Link from 'next/link';
import { AccessGuard, useAccessCode } from '@/components/access-guard';

interface Resume {
  id: number;
  file_key: string;
  file_name: string;
  parsed_content: string;
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

export default function ResumePage() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedResume, setSelectedResume] = useState<Resume | null>(null);
  const { accessCodeId } = useAccessCode();

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  }, []);

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      if (accessCodeId) {
        formData.append('access_code_id', accessCodeId.toString());
      }

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
      const params = new URLSearchParams();
      if (accessCodeId) {
        params.append('access_code_id', accessCodeId.toString());
      }
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

  // Fetch resumes when accessCodeId changes
  useEffect(() => {
    if (accessCodeId !== undefined) {
      fetchResumes();
    }
  }, [accessCodeId]);

  return (
    <AccessGuard>
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
          <h1 className="text-3xl font-bold mb-2">简历管理</h1>
          <p className="text-muted-foreground">上传、管理你的简历，支持智能解析</p>
        </div>

        {/* Upload Section */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              上传简历
            </CardTitle>
            <CardDescription>
              支持 PDF、Word (.docx)、TXT 格式，系统将自动解析提取关键信息
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <Input
                  type="file"
                  accept=".pdf,.doc,.docx,.txt"
                  onChange={handleFileSelect}
                  disabled={uploading}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  支持 PDF、Word (.docx)、TXT 格式，系统将自动提取姓名、联系方式、教育经历、工作经验、技能等信息
                </p>
                {selectedFile && (
                  <p className="text-sm text-muted-foreground mt-2">
                    已选择: {selectedFile.name}
                  </p>
                )}
              </div>
              <Button onClick={handleUpload} disabled={!selectedFile || uploading}>
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
            <h2 className="text-xl font-semibold">我的简历</h2>
            <Button variant="outline" size="sm" onClick={fetchResumes}>
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
                <CardContent className="pt-6">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div className="flex items-start gap-4 flex-1">
                      <div className="w-12 h-12 rounded-lg bg-green-100 dark:bg-green-900 flex items-center justify-center flex-shrink-0">
                        <FileText className="h-6 w-6 text-green-600" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg">{resume.file_name}</h3>
                        <div className="flex flex-wrap gap-2 mt-2">
                          <Badge variant="secondary">
                            <Calendar className="h-3 w-3 mr-1" />
                            {new Date(resume.created_at).toLocaleDateString()}
                          </Badge>
                          {resume.user_info?.name ? (
                            <Badge variant="outline">
                              <User className="h-3 w-3 mr-1" />
                              {resume.user_info.name}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-yellow-600">
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              解析中...
                            </Badge>
                          )}
                        </div>
                        {resume.parsed_content && !resume.parsed_content.includes('正在解析') && (
                          <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                            {resume.parsed_content.substring(0, 150)}...
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => setSelectedResume(resume)}
                          >
                            查看详情
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>{resume.file_name}</DialogTitle>
                            <DialogDescription>
                              简历解析结果
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4">
                            {resume.user_info?.name && (
                              <div>
                                <h4 className="font-semibold mb-2">基本信息</h4>
                                <div className="grid grid-cols-2 gap-2 text-sm">
                                  {resume.user_info.name && <p><strong>姓名:</strong> {resume.user_info.name}</p>}
                                  {resume.user_info.email && <p><strong>邮箱:</strong> {resume.user_info.email}</p>}
                                  {resume.user_info.phone && <p><strong>电话:</strong> {resume.user_info.phone}</p>}
                                </div>
                              </div>
                            )}
                            {resume.user_info?.education && resume.user_info.education.length > 0 && (
                              <div>
                                <h4 className="font-semibold mb-2">教育背景</h4>
                                <ul className="list-disc list-inside text-sm space-y-1">
                                  {resume.user_info.education.map((edu, i) => (
                                    <li key={i}>{edu}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {resume.user_info?.experience && resume.user_info.experience.length > 0 && (
                              <div>
                                <h4 className="font-semibold mb-2">工作经历</h4>
                                <ul className="list-disc list-inside text-sm space-y-1">
                                  {resume.user_info.experience.map((exp, i) => (
                                    <li key={i}>{exp}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {resume.user_info?.skills && resume.user_info.skills.length > 0 && (
                              <div>
                                <h4 className="font-semibold mb-2">技能标签</h4>
                                <div className="flex flex-wrap gap-2">
                                  {resume.user_info.skills.map((skill, i) => (
                                    <Badge key={i} variant="secondary">{skill}</Badge>
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
                        onClick={() => deleteResume(resume.id)}
                      >
                        <Trash2 className="h-4 w-4" />
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
    </AccessGuard>
  );
}
