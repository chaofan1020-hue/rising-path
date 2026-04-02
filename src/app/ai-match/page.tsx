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
  Brain, 
  Target, 
  Loader2, 
  CheckCircle, 
  ArrowRight,
  Briefcase,
  Sparkles,
  TrendingUp,
  MapPin,
} from 'lucide-react';
import Link from 'next/link';

interface Resume {
  id: number;
  file_name: string;
  user_info: {
    name?: string;
    skills?: string[];
  };
}

interface JobConfig {
  id: number;
  config_type: string;
  config_value: string;
  sort_order: number;
  is_active: boolean;
}

interface MatchResult {
  job_id: number;
  job_title: string;
  company: string;
  match_score: number;
  match_reason: string;
  suggestions: string;
}

export default function AIMatchPage() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<string>('');
  const [selectedRegion, setSelectedRegion] = useState<string>('全部');
  const [regions, setRegions] = useState<JobConfig[]>([]);
  const [matching, setMatching] = useState(false);
  const [matchProgress, setMatchProgress] = useState(0);
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);

  useEffect(() => {
    fetchResumes();
    fetchConfigs();
  }, []);

  const fetchResumes = async () => {
    try {
      const response = await fetch('/api/resume');
      const data = await response.json();
      setResumes(data.resumes || []);
    } catch (error) {
      console.error('Failed to fetch resumes:', error);
    }
  };

  const fetchConfigs = async () => {
    try {
      const response = await fetch('/api/configs');
      const data = await response.json();
      setRegions(data.configs?.region || []);
    } catch (error) {
      console.error('Failed to fetch configs:', error);
    }
  };

  const handleMatch = async () => {
    if (!selectedResumeId) return;

    setMatching(true);
    setMatchProgress(0);
    setMatchResults([]);

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setMatchProgress((prev) => Math.min(prev + 5, 90));
      }, 100);

      const response = await fetch('/api/ai/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          resumeId: selectedResumeId,
          region: selectedRegion !== '全部' ? selectedRegion : undefined,
        }),
      });

      clearInterval(progressInterval);
      setMatchProgress(100);

      const data = await response.json();
      setMatchResults(data.matches || []);

      setTimeout(() => {
        setMatchProgress(0);
      }, 1000);
    } catch (error) {
      console.error('Match failed:', error);
    } finally {
      setMatching(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreLabel = (score: number) => {
    if (score >= 80) return '高度匹配';
    if (score >= 60) return '中等匹配';
    return '匹配度较低';
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
            <Link href="/resume">
              <Button variant="ghost" size="sm">简历管理</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Page Title */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
            <Brain className="h-8 w-8 text-purple-600" />
            AI智能选岗
          </h1>
          <p className="text-muted-foreground">
            基于你的简历，AI将智能分析并推荐最匹配的岗位
          </p>
        </div>

        {/* Match Form */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              开始匹配
            </CardTitle>
            <CardDescription>
              选择一份简历，AI将分析你的技能和经验，匹配最合适的岗位
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">选择简历</label>
                <Select value={selectedResumeId} onValueChange={setSelectedResumeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择简历" />
                  </SelectTrigger>
                  <SelectContent>
                    {resumes.map((resume) => (
                      <SelectItem key={resume.id} value={resume.id.toString()}>
                        {resume.file_name}
                        {resume.user_info?.name && ` - ${resume.user_info.name}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full md:w-48">
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">目标地区</label>
                <Select value={selectedRegion} onValueChange={setSelectedRegion}>
                  <SelectTrigger>
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <SelectValue placeholder="全部地区" />
                    </div>
                  </SelectTrigger>
                  <SelectContent translate="no">
                    <SelectItem value="全部">全部地区</SelectItem>
                    {regions.map((region) => (
                      <SelectItem key={region.id} value={region.config_value}>
                        {region.config_value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button 
                  onClick={handleMatch} 
                  disabled={!selectedResumeId || matching}
                  className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 w-full md:w-auto"
                >
                  {matching ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      匹配中...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      开始AI匹配
                    </>
                  )}
                </Button>
              </div>
            </div>

            {matching && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">正在分析简历并匹配岗位...</span>
                  <span className="text-sm font-medium">{matchProgress}%</span>
                </div>
                <Progress value={matchProgress} className="h-2" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Match Results */}
        {matchResults.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                匹配结果
              </h2>
              <Badge variant="secondary">共 {matchResults.length} 个推荐</Badge>
            </div>

            {matchResults.map((result, index) => (
              <Card key={result.job_id} className="hover:shadow-lg transition-all">
                <CardContent className="pt-6">
                  <div className="flex flex-col md:flex-row gap-6">
                    {/* Score */}
                    <div className="flex flex-col items-center justify-center p-4 rounded-lg bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950 dark:to-blue-950">
                      <div className={`text-4xl font-bold ${getScoreColor(result.match_score)}`}>
                        {result.match_score}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">匹配分数</div>
                      <Badge className="mt-2" variant={result.match_score >= 80 ? 'default' : 'secondary'}>
                        {getScoreLabel(result.match_score)}
                      </Badge>
                    </div>

                    {/* Details */}
                    <div className="flex-1 space-y-4">
                      <div>
                        <h3 className="text-lg font-semibold">{result.job_title}</h3>
                        <p className="text-muted-foreground">{result.company}</p>
                      </div>

                      <div>
                        <h4 className="font-medium flex items-center gap-2 mb-2">
                          <TrendingUp className="h-4 w-4 text-green-600" />
                          匹配原因
                        </h4>
                        <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                          {result.match_reason}
                        </p>
                      </div>

                      {result.suggestions && (
                        <div>
                          <h4 className="font-medium flex items-center gap-2 mb-2">
                            <Sparkles className="h-4 w-4 text-orange-600" />
                            优化建议
                          </h4>
                          <p className="text-sm text-muted-foreground bg-orange-50 dark:bg-orange-950/30 p-3 rounded-lg">
                            {result.suggestions}
                          </p>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Button size="sm" asChild>
                          <Link href={`/jobs/${result.job_id}`}>
                            查看岗位
                          </Link>
                        </Button>
                        <Button size="sm" variant="outline">
                          立即申请
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!matching && matchResults.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <Brain className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium mb-2">选择简历开始匹配</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                AI将分析你的简历内容，结合岗位要求，为你推荐最匹配的工作机会
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
