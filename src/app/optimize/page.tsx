'use client';

import { useState, useEffect, Suspense } from 'react';
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
  ArrowRight,
  FileCheck,
} from 'lucide-react';
import Link from 'next/link';

interface Resume {
  id: number;
  file_name: string;
  parsed_content: string;
  user_info: Record<string, unknown>;
}

function OptimizePageContent() {
  const searchParams = useSearchParams();
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<string>('');
  const [targetCompany, setTargetCompany] = useState('');
  const [targetPosition, setTargetPosition] = useState('');
  const [suggestions, setSuggestions] = useState('');
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeProgress, setOptimizeProgress] = useState(0);
  const [originalContent, setOriginalContent] = useState('');
  const [optimizedContent, setOptimizedContent] = useState('');
  const [showResult, setShowResult] = useState(false);

  useEffect(() => {
    fetchResumes();
  }, []);

  useEffect(() => {
    // Read URL parameters and pre-fill form
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
    try {
      const response = await fetch('/api/resume');
      const data = await response.json();
      setResumes(data.resumes || []);
    } catch (error) {
      console.error('Failed to fetch resumes:', error);
    }
  };

  const handleOptimize = async () => {
    if (!selectedResumeId || !targetPosition) return;

    setOptimizing(true);
    setOptimizeProgress(0);
    setOptimizedContent('');

    // Get original resume content
    const selectedResume = resumes.find(r => r.id === parseInt(selectedResumeId));
    const original = selectedResume?.parsed_content || JSON.stringify(selectedResume?.user_info, null, 2) || '';
    setOriginalContent(original);

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
        }),
      });

      clearInterval(progressInterval);
      setOptimizeProgress(100);

      const data = await response.json();
      setOptimizedContent(data.optimized_content || '');
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
            {/* AI选岗优化建议 */}
            {suggestions && (
              <div className="p-4 rounded-lg bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 border border-purple-100 dark:border-purple-900">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="h-4 w-4 text-white" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-medium text-sm mb-1">来自AI选岗的优化建议</h4>
                    <p className="text-sm text-muted-foreground">{suggestions}</p>
                  </div>
                </div>
              </div>
            )}
            
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
        <DialogContent className="max-w-6xl max-h-[90vh] !flex !flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              简历优化完成
            </DialogTitle>
            <DialogDescription>
              AI已根据目标岗位优化了您的简历内容，以下是原简历与优化后简历的对比
            </DialogDescription>
          </DialogHeader>
          
          {/* Comparison View */}
          <div className="flex-1 min-h-0 overflow-auto px-6 py-4">
            <div className="grid md:grid-cols-2 gap-6 min-h-[400px]">
              {/* Original Resume */}
              <div className="flex flex-col h-[400px] md:h-[50vh]">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b shrink-0">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                    <FileText className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                  </div>
                  <div>
                    <h4 className="font-medium text-sm">原简历</h4>
                    <p className="text-xs text-muted-foreground">优化前内容</p>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 border">
                  <pre className="whitespace-pre-wrap text-sm font-mono text-gray-700 dark:text-gray-300">
                    {originalContent}
                  </pre>
                </div>
              </div>

              {/* Arrow */}
              <div className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                <div className="w-12 h-12 rounded-full bg-gradient-to-r from-orange-500 to-red-500 flex items-center justify-center shadow-lg">
                  <ArrowRight className="h-6 w-6 text-white" />
                </div>
              </div>

              {/* Optimized Resume */}
              <div className="flex flex-col h-[400px] md:h-[50vh]">
                <div className="flex items-center justify-between mb-3 pb-2 border-b shrink-0">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-r from-orange-100 to-red-100 dark:from-orange-900/30 dark:to-red-900/30 flex items-center justify-center">
                      <FileCheck className="h-4 w-4 text-orange-600" />
                    </div>
                    <div>
                      <h4 className="font-medium text-sm">优化后简历</h4>
                      <p className="text-xs text-muted-foreground">ATS优化内容</p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    <Sparkles className="h-3 w-3 mr-1" />
                    AI优化
                  </Badge>
                </div>
                <div className="flex-1 overflow-y-auto bg-gradient-to-br from-orange-50/50 to-red-50/50 dark:from-orange-950/20 dark:to-red-950/20 rounded-lg p-4 border border-orange-200 dark:border-orange-900">
                  <pre className="whitespace-pre-wrap text-sm font-mono text-gray-800 dark:text-gray-200">
                    {optimizedContent}
                  </pre>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 px-6 py-4 border-t shrink-0 bg-background">
            <Button variant="outline" size="sm" onClick={handleCopy}>
              <Copy className="mr-2 h-4 w-4" />
              复制优化内容
            </Button>
            <Button size="sm" className="bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700">
              <Download className="mr-2 h-4 w-4" />
              下载简历
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function OptimizePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    }>
      <OptimizePageContent />
    </Suspense>
  );
}
