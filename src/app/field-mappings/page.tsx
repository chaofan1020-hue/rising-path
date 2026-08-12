'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Loader2, Save, Download, ClipboardList, MapPin, Sparkles } from 'lucide-react';
import { AuthGuard } from '@/components/auth-guard';
import { apiFetch } from '@/lib/api-client';
import { Header1 } from '@/components/header1';
import ApplicationList from '@/components/application-list';
import PageBackButton from '@/components/page-back-button';

interface ProfileSource {
  source: 'resume' | 'ai' | 'manual' | 'empty';
  confidence: number;
  editCount?: number;
  confirmCount?: number;
  ignoreCount?: number;
  updatedAt?: string;
}

interface PrefillMetrics {
  totalFeedback: number;
  confirmed: number;
  edited: number;
  ignored: number;
  confirmationRate: number;
  correctionRate: number;
  editHistoryCount: number;
  activeFields: number;
}

interface ResumeOption {
  id: number;
  file_name: string;
  processing_status?: string;
}

interface ApplicationProfile {
  personal: Record<string, string>;
  links: Record<string, string>;
  education: Array<Record<string, string>>;
  experience: Array<Record<string, string>>;
  skills: string[];
  languages: string[];
  workAuthorization: string;
  visaStatus: string;
  summary: string;
}

const PERSONAL_FIELDS = [
  { key: 'firstName', label: '名', placeholder: 'First name' },
  { key: 'lastName', label: '姓', placeholder: 'Last name' },
  { key: 'email', label: '邮箱', placeholder: 'you@example.com' },
  { key: 'phone', label: '电话', placeholder: '+1 234 567 8900' },
  { key: 'address', label: '地址', placeholder: 'Street address' },
  { key: 'city', label: '城市', placeholder: 'City' },
  { key: 'state', label: '州/省', placeholder: 'State / Province' },
  { key: 'zipCode', label: '邮编', placeholder: 'ZIP / Postal code' },
  { key: 'country', label: '国家', placeholder: 'Country' },
];

const LINK_FIELDS = [
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/in/...' },
  { key: 'github', label: 'GitHub', placeholder: 'https://github.com/...' },
  { key: 'portfolio', label: '作品集', placeholder: 'https://...' },
];

const sourceLabel: Record<string, string> = {
  resume: '简历',
  ai: 'AI 推测',
  manual: '手动',
  empty: '未填写',
};

function FieldSource({ source }: { source?: ProfileSource }) {
  if (!source) return <Badge variant="outline">未填写</Badge>;
  const color =
    source.source === 'resume'
      ? 'default'
      : source.source === 'ai'
        ? 'secondary'
        : source.source === 'manual'
          ? 'default'
          : 'outline';
  return (
    <Badge variant={color as 'default' | 'secondary' | 'outline'}>
      {sourceLabel[source.source]} · {Math.round(source.confidence * 100)}%
      {source.confirmCount ? ` · 确认${source.confirmCount}次` : ''}
      {source.editCount ? ` · 修正${source.editCount}次` : ''}
      {source.ignoreCount ? ` · 忽略${source.ignoreCount}次` : ''}
    </Badge>
  );
}

function AutoApplicationContent() {
  const [profile, setProfile] = useState<ApplicationProfile | null>(null);
  const [source, setSource] = useState<Record<string, ProfileSource>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveDone, setSaveDone] = useState(false);
  const [activeTab, setActiveTab] = useState('profile');
  const [metrics, setMetrics] = useState<PrefillMetrics | null>(null);
  const [resumes, setResumes] = useState<ResumeOption[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<number | null>(null);
  const [aiFilling, setAiFilling] = useState(false);

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab === 'applications' || tab === 'extension') setActiveTab(tab);
  }, []);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/application-profile');
      const data = await res.json();
      setProfile(data.profile);
      setSource(data.fieldStats || data.source || {});
      setSelectedResumeId(data.resumeId ?? null);
    } catch (error) {
      console.error('Failed to load application profile:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    apiFetch('/api/resume')
      .then((res) => (res.ok ? res.json() : { resumes: [] }))
      .then((data) => setResumes(data.resumes || []))
      .catch(() => setResumes([]));
  }, []);

  useEffect(() => {
    if (selectedResumeId === null && resumes.length > 0) {
      setSelectedResumeId(resumes[0].id);
    }
  }, [resumes, selectedResumeId]);

  useEffect(() => {
    apiFetch('/api/application/prefill-metrics')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setMetrics(data))
      .catch(() => {});
  }, []);

  const updatePersonal = (key: string, value: string) => {
    if (!profile) return;
    setProfile({ ...profile, personal: { ...profile.personal, [key]: value } });
    setSaveDone(false);
  };

  const updateLink = (key: string, value: string) => {
    if (!profile) return;
    setProfile({ ...profile, links: { ...profile.links, [key]: value } });
    setSaveDone(false);
  };

  const updateEducation = (index: number, value: string) => {
    if (!profile) return;
    const education = profile.education.map((entry, idx) =>
      idx === index ? { ...entry, raw: value } : entry,
    );
    setProfile({ ...profile, education });
    setSaveDone(false);
  };

  const updateExperience = (index: number, value: string) => {
    if (!profile) return;
    const experience = profile.experience.map((entry, idx) =>
      idx === index ? { ...entry, raw: value } : entry,
    );
    setProfile({ ...profile, experience });
    setSaveDone(false);
  };

  const handleAiFill = async () => {
    if (!selectedResumeId || aiFilling) return;
    setAiFilling(true);
    try {
      const res = await apiFetch('/api/application-profile/ai-fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeId: selectedResumeId }),
      });
      const data = await res.json();
      if (!res.ok || !data.profile) {
        throw new Error(data.error || 'AI 填写失败');
      }
      setProfile(data.profile);
      setSource(data.fieldStats || data.source || {});
      setSaveDone(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'AI 填写失败');
    } finally {
      setAiFilling(false);
    }
  };

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/application-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile }),
      });
      const data = await res.json();
      if (data.profile) {
        setProfile(data.profile);
        setSource(data.fieldStats || data.source || {});
        setSaveDone(true);
      } else {
        alert(data.error || '保存失败');
      }
    } catch {
      alert('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const pendingFields = source ? Object.values(source).filter((s) => s.source === 'empty').length : 0;

  return (
    <div className="min-h-screen bg-background">
      <Header1 />
      <main className="container mx-auto px-4 py-8 pt-20 max-w-5xl">
        <div className="mb-8">
          <PageBackButton fallbackHref="/jobs" className="mb-3" />
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
            <ClipboardList className="h-8 w-8 text-primary" />
            自动网申
          </h1>
          <p className="text-muted-foreground">
            统一求职档案，配合浏览器扩展自动填写外部申请表单；扩展只填不提交。
          </p>
        </div>

        {metrics && (
          <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3 max-w-2xl">
            <Metric label="AI 值确认率" value={`${metrics.confirmationRate}%`} />
            <Metric label="用户修正率" value={`${metrics.correctionRate}%`} />
            <Metric label="已忽略建议" value={String(metrics.ignored)} />
            <Metric label="手动修正记录" value={String(metrics.editHistoryCount)} />
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="profile">求职档案</TabsTrigger>
            <TabsTrigger value="extension">扩展安装</TabsTrigger>
            <TabsTrigger value="applications">申请记录</TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>求职档案</CardTitle>
                    <CardDescription>
                      来源标记会同步到扩展的确认列表；手动修改后来源变为“手动”。还有 {pendingFields} 个字段待补充。
                    </CardDescription>
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <Select
                      value={selectedResumeId ? String(selectedResumeId) : undefined}
                      onValueChange={(value) => setSelectedResumeId(Number(value))}
                    >
                      <SelectTrigger className="w-full sm:w-56">
                        <SelectValue placeholder="选择简历" />
                      </SelectTrigger>
                      <SelectContent>
                        {resumes.map((resume) => (
                          <SelectItem key={resume.id} value={String(resume.id)}>
                            {resume.file_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button onClick={handleAiFill} disabled={!selectedResumeId || aiFilling}>
                      {aiFilling ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />AI 填写中...</>
                      ) : (
                        <><Sparkles className="h-4 w-4 mr-2" />AI 自动填写</>
                      )}
                    </Button>
                  <Button onClick={handleSave} disabled={saving || !profile}>
                    {saving ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />保存中...</>
                    ) : (
                      <><Save className="h-4 w-4 mr-2" />{saveDone ? '已保存' : '保存档案'}</>
                    )}
                  </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {loading || !profile ? (
                  <div className="text-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                    <p className="text-muted-foreground">加载中...</p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    <section>
                      <h3 className="text-sm font-medium mb-3">教育经历</h3>
                      {profile.education.length === 0 ? (
                        <p className="text-sm text-muted-foreground">暂无教育经历，点击 AI 自动填写。</p>
                      ) : (
                        <div className="space-y-3">
                          {profile.education.map((entry, index) => (
                            <Textarea
                              key={index}
                              rows={2}
                              value={entry.raw || ''}
                              onChange={(event) => updateEducation(index, event.target.value)}
                            />
                          ))}
                        </div>
                      )}
                    </section>

                    <section>
                      <h3 className="text-sm font-medium mb-3">工作 / 实习经历</h3>
                      {profile.experience.length === 0 ? (
                        <p className="text-sm text-muted-foreground">暂无经历，点击 AI 自动填写。</p>
                      ) : (
                        <div className="space-y-3">
                          {profile.experience.map((entry, index) => (
                            <Textarea
                              key={index}
                              rows={3}
                              value={entry.raw || ''}
                              onChange={(event) => updateExperience(index, event.target.value)}
                            />
                          ))}
                        </div>
                      )}
                    </section>

                    <section>
                      <h3 className="text-sm font-medium mb-3">个人信息</h3>
                      <div className="grid md:grid-cols-2 gap-4">
                        {PERSONAL_FIELDS.map((field) => (
                          <div key={field.key} className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <label className="text-sm font-medium">{field.label}</label>
                              <FieldSource source={source[`personal.${field.key}`]} />
                            </div>
                            <Input
                              value={profile.personal[field.key] || ''}
                              placeholder={field.placeholder}
                              onChange={(e) => updatePersonal(field.key, e.target.value)}
                            />
                          </div>
                        ))}
                      </div>
                    </section>

                    <section>
                      <h3 className="text-sm font-medium mb-3">个人链接</h3>
                      <div className="grid md:grid-cols-3 gap-4">
                        {LINK_FIELDS.map((field) => (
                          <div key={field.key} className="space-y-1.5">
                            <label className="text-sm font-medium">{field.label}</label>
                            <Input
                              value={profile.links[field.key] || ''}
                              placeholder={field.placeholder}
                              onChange={(e) => updateLink(field.key, e.target.value)}
                            />
                          </div>
                        ))}
                      </div>
                    </section>

                    <section>
                      <h3 className="text-sm font-medium mb-3">技能与开放信息</h3>
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="text-sm font-medium">技能</label>
                            <FieldSource source={source.skills} />
                          </div>
                          <Input
                            value={(profile.skills || []).join(', ')}
                            placeholder="Python, SQL, Communication..."
                            onChange={(e) =>
                              setProfile({
                                ...profile,
                                skills: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                              })
                            }
                          />
                        </div>
                        <div className="grid md:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium">工作授权</label>
                            <Input
                              value={profile.workAuthorization || ''}
                              placeholder="US Citizen / OPT / H1B..."
                              onChange={(e) => setProfile({ ...profile, workAuthorization: e.target.value })}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium">签证状态</label>
                            <Input
                              value={profile.visaStatus || ''}
                              placeholder="F-1 / OPT / Other..."
                              onChange={(e) => setProfile({ ...profile, visaStatus: e.target.value })}
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium">自我介绍 / 开放题草稿</label>
                          <Textarea
                            rows={4}
                            value={profile.summary || ''}
                            placeholder="用于 Cover Letter 和开放题预填"
                            onChange={(e) => setProfile({ ...profile, summary: e.target.value })}
                          />
                        </div>
                      </div>
                    </section>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="extension">
            <Card>
              <CardHeader>
                <CardTitle>浏览器扩展</CardTitle>
                <CardDescription>
                  第一版以本地加载方式使用，扩展只负责识别和填写，绝不自动提交。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3 rounded-lg border p-4">
                  <Download className="h-5 w-5 text-primary mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">安装扩展</p>
                    <p className="text-sm text-muted-foreground">
                      打开 Chrome 的扩展管理页，启用“开发者模式”，选择“加载已解压的扩展程序”，目录为项目下的 extension。
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-lg border p-4">
                  <MapPin className="h-5 w-5 text-primary mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">使用流程</p>
                    <p className="text-sm text-muted-foreground">
                      先在 Liorvix 登录并进入岗位详情页，点击“自动网申”打开官网申请页；扩展会自动识别字段并填写，你确认后在官网手动提交。
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="applications">
            <ApplicationList />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

export default function FieldMappingsPage() {
  return (
    <AuthGuard>
      <AutoApplicationContent />
    </AuthGuard>
  );
}
