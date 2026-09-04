'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, BriefcaseBusiness, Check, ChevronRight, ClipboardList, FilePenLine, FileText, Loader2, Puzzle, Save, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Header1 } from '@/components/header1';
import { apiFetch } from '@/lib/api-client';
import { useLanguage, type Locale } from '@/lib/language-context';

interface ProfileSource { source: 'resume' | 'ai' | 'manual' | 'empty'; confidence: number; }
interface ResumeOption { id: number; file_name: string; processing_status?: string; segmentation_confirmed?: boolean; }
interface JobOption { id: number; title: string; company: string; region: string; direction?: string; }
interface ApplicationProfile {
  personal: Record<string, string>; links: Record<string, string>; education: Array<Record<string, string>>; experience: Array<Record<string, string>>;
  skills: string[]; languages: string[]; workAuthorization: string; visaStatus: string; summary: string;
}
type AiFillJob = {
  id: number;
  resumeId: number;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  error?: string | null;
};

const PERSONAL_FIELDS = [
  { key: 'firstName', label: 'firstName', placeholder: 'First name' }, { key: 'lastName', label: 'lastName', placeholder: 'Last name' },
  { key: 'email', label: 'email', placeholder: 'you@example.com' }, { key: 'phone', label: 'phone', placeholder: '+1 234 567 8900' },
  { key: 'address', label: 'address', placeholder: 'Street address' }, { key: 'city', label: 'city', placeholder: 'City' },
  { key: 'state', label: 'state', placeholder: 'State / Province' }, { key: 'zipCode', label: 'zipCode', placeholder: 'ZIP / Postal code' }, { key: 'country', label: 'country', placeholder: 'Country' },
];
const LINK_FIELDS = [{ key: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/in/...' }, { key: 'github', label: 'GitHub', placeholder: 'https://github.com/...' }, { key: 'portfolio', label: 'portfolio', placeholder: 'https://...' }];

const copy: Record<Locale, Record<string, string>> = {
  'zh-CN': {
    title: '网申工作台', subtitle: '选好岗位和简历，接下来的填写交给浏览器助手。最终提交始终由你完成。', prepTitle: '准备一次有把握的申请', prepDescription: '先选岗位和简历，再进入岗位详情确认匹配度并打开招聘官网。', profileSettings: '档案设置', loading: '加载中…', start: '开始网申', records: '申请记录', profile: '求职档案', back: '返回岗位',
    stepRole: '选择岗位', stepResume: '选择简历', roleHint: '从岗位库中选一份准备投递的岗位。', resumeHint: '选择用于本次投递的已确认简历。', searchJobs: '搜索公司或岗位', noJobs: '没有找到匹配岗位', selectJob: '选择岗位', selectResume: '选择简历',
    noResume: '还没有可用于网申的已确认简历。', manageResume: '管理简历', profileReady: '求职档案已准备', profileNeeds: '还有 {count} 项资料待补充', completeProfile: '完善档案', extension: '浏览器助手', extensionHint: '安装后会在招聘官网识别并填写字段。', install: '安装助手', continue: '打开官网并开始填写', preparing: '正在准备…', selectFirst: '请先选择岗位和简历', openFailed: '无法开始网申，请重试', saved: '已保存', save: '保存档案', saving: '保存中…', aiFill: '根据简历更新', filling: '正在整理…', profileTitle: '求职档案', profileHint: '这是浏览器助手填写表单时使用的统一资料。只在需要更新时编辑。', education: '教育经历', experience: '工作 / 实习经历', personal: '个人信息', links: '个人链接', skills: '技能', authorization: '工作授权', visa: '签证状态', summary: '自我介绍 / 开放题草稿', emptyEducation: '暂无教育经历，可根据简历更新。', emptyExperience: '暂无经历，可根据简历更新。', skillsPlaceholder: 'Python, SQL, Communication...', summaryPlaceholder: '用于 Cover Letter 和开放题预填', fieldFirstName: '名', fieldLastName: '姓', fieldEmail: '邮箱', fieldPhone: '电话', fieldAddress: '地址', fieldCity: '城市', fieldState: '州 / 省', fieldZipCode: '邮编', fieldCountry: '国家', fieldPortfolio: '作品集',
  },
  'zh-TW': {
    title: '網申工作台', subtitle: '選好職位和履歷，接下來的填寫交給瀏覽器助手。最終提交始終由你完成。', prepTitle: '準備一次有把握的申請', prepDescription: '先選職位和履歷，再進入職位詳情確認匹配度並開啟招聘官網。', profileSettings: '檔案設定', loading: '載入中…', start: '開始網申', records: '申請記錄', profile: '求職檔案', back: '返回職位',
    stepRole: '選擇職位', stepResume: '選擇履歷', roleHint: '從職位庫選一份準備投遞的職位。', resumeHint: '選擇用於本次投遞的已確認履歷。', searchJobs: '搜尋公司或職位', noJobs: '沒有找到匹配職位', selectJob: '選擇職位', selectResume: '選擇履歷',
    noResume: '還沒有可用於網申的已確認履歷。', manageResume: '管理履歷', profileReady: '求職檔案已準備', profileNeeds: '還有 {count} 項資料待補充', completeProfile: '完善檔案', extension: '瀏覽器助手', extensionHint: '安裝後會在招聘官網識別並填寫欄位。', install: '安裝助手', continue: '打開官網並開始填寫', preparing: '正在準備…', selectFirst: '請先選擇職位和履歷', openFailed: '無法開始網申，請重試', saved: '已儲存', save: '儲存檔案', saving: '儲存中…', aiFill: '根據履歷更新', filling: '正在整理…', profileTitle: '求職檔案', profileHint: '這是瀏覽器助手填寫表單時使用的統一資料。只在需要更新時編輯。', education: '教育經歷', experience: '工作 / 實習經歷', personal: '個人資訊', links: '個人連結', skills: '技能', authorization: '工作授權', visa: '簽證狀態', summary: '自我介紹 / 開放題草稿', emptyEducation: '暫無教育經歷，可根據履歷更新。', emptyExperience: '暫無經歷，可根據履歷更新。', skillsPlaceholder: 'Python, SQL, Communication...', summaryPlaceholder: '用於 Cover Letter 和開放題預填', fieldFirstName: '名', fieldLastName: '姓', fieldEmail: '信箱', fieldPhone: '電話', fieldAddress: '地址', fieldCity: '城市', fieldState: '州 / 省', fieldZipCode: '郵遞區號', fieldCountry: '國家', fieldPortfolio: '作品集',
  },
  en: {
    title: 'Application workspace', subtitle: 'Choose a role and resume. Your browser assistant handles repetitive fields; you always submit yourself.', prepTitle: 'Prepare a focused application', prepDescription: 'Choose a role and resume, then review the match and open the employer site.', profileSettings: 'Profile settings', loading: 'Loading…', start: 'Start application', records: 'Applications', profile: 'Profile', back: 'Back to jobs',
    stepRole: 'Choose a role', stepResume: 'Choose a resume', roleHint: 'Pick a role you are ready to apply for.', resumeHint: 'Use a confirmed resume for this application.', searchJobs: 'Search company or role', noJobs: 'No matching roles', selectJob: 'Select a role', selectResume: 'Select a resume',
    noResume: 'You do not have a confirmed resume ready for applications.', manageResume: 'Manage resumes', profileReady: 'Application profile ready', profileNeeds: '{count} profile fields still need attention', completeProfile: 'Complete profile', extension: 'Browser assistant', extensionHint: 'It recognizes and fills fields on the employer site after installation.', install: 'Install assistant', continue: 'Open employer site and start filling', preparing: 'Preparing…', selectFirst: 'Choose a role and resume first', openFailed: 'Could not start the application. Please try again.', saved: 'Saved', save: 'Save profile', saving: 'Saving…', aiFill: 'Update from resume', filling: 'Updating…', profileTitle: 'Application profile', profileHint: 'This is the shared information used by the browser assistant. Edit it only when it needs an update.', education: 'Education', experience: 'Work experience', personal: 'Personal details', links: 'Links', skills: 'Skills', authorization: 'Work authorization', visa: 'Visa status', summary: 'Introduction / long-answer draft', emptyEducation: 'No education entries yet. Update from your resume.', emptyExperience: 'No experience entries yet. Update from your resume.', skillsPlaceholder: 'Python, SQL, Communication...', summaryPlaceholder: 'Used to prefill cover letters and long-answer questions', fieldFirstName: 'First name', fieldLastName: 'Last name', fieldEmail: 'Email', fieldPhone: 'Phone', fieldAddress: 'Address', fieldCity: 'City', fieldState: 'State / province', fieldZipCode: 'Postal code', fieldCountry: 'Country', fieldPortfolio: 'Portfolio',
  },
};
function interpolate(text: string, values: Record<string, string | number> = {}) { return Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, String(value)), text); }

export function AutoApplicationContent() {
  const router = useRouter();
  const { locale } = useLanguage(); const c = copy[locale];
  const [activeTab, setActiveTab] = useState('start'); const [profile, setProfile] = useState<ApplicationProfile | null>(null); const [source, setSource] = useState<Record<string, ProfileSource>>({}); const [profileVersion, setProfileVersion] = useState(0); const [profileLoading, setProfileLoading] = useState(true); const [resumes, setResumes] = useState<ResumeOption[]>([]); const [jobs, setJobs] = useState<JobOption[]>([]); const [jobSearch, setJobSearch] = useState(''); const [selectedJobId, setSelectedJobId] = useState<number | null>(null); const [selectedResumeId, setSelectedResumeId] = useState<number | null>(null); const [saving, setSaving] = useState(false); const [saveDone, setSaveDone] = useState(false); const [aiFilling, setAiFilling] = useState(false); const [aiFillJob, setAiFillJob] = useState<AiFillJob | null>(null); const [starting, setStarting] = useState(false);
  useEffect(() => { const tab = new URLSearchParams(window.location.search).get('tab'); if (tab === 'applications') router.replace('/applications'); else if (tab === 'profile') setActiveTab(tab); }, [router]);
  const loadProfile = useCallback(async () => { setProfileLoading(true); try { const response = await apiFetch('/api/application-profile'); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'profile'); setProfile(data.profile); setSource(data.fieldStats || data.source || {}); setProfileVersion(typeof data.version === 'number' ? data.version : 0); setSelectedResumeId(typeof data.resumeId === 'number' ? data.resumeId : null); const nextJob = (data.aiJob || null) as AiFillJob | null; setAiFillJob(nextJob); setAiFilling(nextJob?.status === 'pending' || nextJob?.status === 'running'); } catch (error) { console.error('Failed to load application profile:', error); } finally { setProfileLoading(false); } }, []);
  useEffect(() => { void loadProfile(); }, [loadProfile]);
  useEffect(() => {
    if (!aiFillJob || (aiFillJob.status !== 'pending' && aiFillJob.status !== 'running')) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const response = await apiFetch(`/api/application-profile/ai-fill?jobId=${aiFillJob.id}`);
        const data = await response.json();
        if (stopped || !response.ok || !data.job) {
          if (!stopped) timer = setTimeout(() => void poll(), 5000);
          return;
        }
        const nextJob = data.job as AiFillJob;
        setAiFillJob(nextJob);
        setAiFilling(nextJob.status === 'pending' || nextJob.status === 'running');
        if (nextJob.status === 'succeeded') {
          await loadProfile();
        } else if (nextJob.status === 'pending' || nextJob.status === 'running') {
          timer = setTimeout(() => void poll(), 2500);
        }
      } catch {
        if (!stopped) timer = setTimeout(() => void poll(), 5000);
      }
    };
    void poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [aiFillJob?.id, loadProfile]);
  useEffect(() => { apiFetch('/api/resume').then((response) => response.ok ? response.json() : { resumes: [] }).then((data) => setResumes((data.resumes || []).filter((resume: ResumeOption) => resume.processing_status === 'ready' && resume.segmentation_confirmed === true))).catch(() => setResumes([])); apiFetch('/api/jobs?summary=1&limit=100').then((response) => response.ok ? response.json() : { jobs: [] }).then((data) => setJobs(data.jobs || [])).catch(() => setJobs([])); }, []);
  useEffect(() => { if (!selectedResumeId && resumes.length === 1) setSelectedResumeId(resumes[0].id); }, [resumes, selectedResumeId]);
  const selectedJob = jobs.find((job) => job.id === selectedJobId) || null;
  const filteredJobs = useMemo(() => { const term = jobSearch.trim().toLocaleLowerCase(); return (term ? jobs.filter((job) => `${job.title} ${job.company} ${job.region}`.toLocaleLowerCase().includes(term)) : jobs).slice(0, 80); }, [jobSearch, jobs]);
  const pendingFields = Object.values(source).filter((field) => field.source === 'empty').length;
  const updateProfile = (next: ApplicationProfile) => { setProfile(next); setSaveDone(false); };
  const handleAiFill = async () => { if (!selectedResumeId || aiFilling) return; setAiFilling(true); try { const response = await apiFetch('/api/application-profile/ai-fill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resumeId: selectedResumeId }) }); const data = await response.json(); if (!response.ok || !data.job) throw new Error(data.error || c.openFailed); setAiFillJob(data.job as AiFillJob); setSaveDone(false); } catch (error) { setAiFilling(false); window.alert(error instanceof Error ? error.message : c.openFailed); } };
  const handleSave = async () => { if (!profile || saving) return; setSaving(true); try { const response = await apiFetch('/api/application-profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile, version: profileVersion }) }); const data = await response.json(); if (!response.ok || !data.profile) throw new Error(data.error || c.openFailed); setProfile(data.profile); setSource(data.fieldStats || data.source || {}); setProfileVersion(typeof data.version === 'number' ? data.version : profileVersion + 1); setSaveDone(true); } catch (error) { window.alert(error instanceof Error ? error.message : c.openFailed); } finally { setSaving(false); } };
  const handleStart = () => { if (!selectedJob || !selectedResumeId) { window.alert(c.selectFirst); return; } setStarting(true); window.location.assign(`/jobs/${selectedJob.id}?resumeId=${selectedResumeId}`); };
  return (
    <div className="min-h-screen bg-background">
      <Header1 />
      <main className="container mx-auto max-w-6xl px-4 pb-16 pt-24 md:px-6 md:pt-28">
        <header className="mb-8 flex items-start gap-3">
          <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"><ClipboardList className="h-5 w-5" /></span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">Liorvix workflow</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground md:text-3xl">{c.title}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">{c.subtitle}</p>
          </div>
        </header>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-6">
          <TabsList className="h-11 w-full justify-start gap-1 rounded-lg border bg-card p-1 sm:w-fit">
            <TabsTrigger className="px-4" value="start">{c.start}</TabsTrigger>
            <TabsTrigger className="px-4" value="profile">{c.profile}</TabsTrigger>
          </TabsList>

          <TabsContent value="start" className="mt-0 space-y-5">
            <section className="overflow-hidden rounded-lg border bg-card">
              <div className="border-b bg-muted/20 px-5 py-4 md:px-6"><p className="text-sm font-semibold text-foreground">{c.prepTitle}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{c.prepDescription}</p></div>
              <div className="grid divide-y md:grid-cols-[1fr_1fr] md:divide-x md:divide-y-0">
                <WorkflowStep number="1" title={c.stepRole} hint={c.roleHint} complete={Boolean(selectedJob)}>
                  <Input value={jobSearch} onChange={(event) => setJobSearch(event.target.value)} placeholder={c.searchJobs} className="mb-3" />
                  <Select value={selectedJobId ? String(selectedJobId) : undefined} onValueChange={(value) => setSelectedJobId(Number(value))}><SelectTrigger><SelectValue placeholder={c.selectJob} /></SelectTrigger><SelectContent>{filteredJobs.length ? filteredJobs.map((job) => <SelectItem key={job.id} value={String(job.id)}><span className="block max-w-[250px] truncate">{job.title} · {job.company}</span></SelectItem>) : <div className="px-2 py-4 text-center text-sm text-muted-foreground">{c.noJobs}</div>}</SelectContent></Select>
                  {selectedJob && <p className="mt-3 truncate text-xs text-muted-foreground">{selectedJob.company} · {selectedJob.region}</p>}
                </WorkflowStep>
                <WorkflowStep number="2" title={c.stepResume} hint={c.resumeHint} complete={Boolean(selectedResumeId)}>
                  {resumes.length ? <Select value={selectedResumeId ? String(selectedResumeId) : undefined} onValueChange={(value) => setSelectedResumeId(Number(value))}><SelectTrigger><SelectValue placeholder={c.selectResume} /></SelectTrigger><SelectContent>{resumes.map((resume) => <SelectItem key={resume.id} value={String(resume.id)}>{resume.file_name}</SelectItem>)}</SelectContent></Select> : <div className="flex flex-col items-start gap-3"><p className="text-sm leading-6 text-muted-foreground">{c.noResume}</p><Button asChild size="sm" variant="outline"><Link href="/resume"><FileText className="mr-2 h-4 w-4" />{c.manageResume}</Link></Button></div>}
                </WorkflowStep>
              </div>
              <div className="flex flex-col gap-4 border-t bg-muted/20 px-5 py-5 sm:flex-row sm:items-center sm:justify-between md:px-6">
                <div className="flex min-w-0 items-start gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"><Puzzle className="h-4 w-4" /></span><div><p className="text-sm font-medium">{c.extension}</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{c.extensionHint} <Link href="/extension" className="font-medium text-zinc-900 hover:underline dark:text-white">{c.install}<ChevronRight className="inline h-3 w-3" /></Link></p></div></div>
                <Button onClick={handleStart} disabled={!selectedJob || !selectedResumeId || starting} className="w-full bg-zinc-900 text-white hover:bg-zinc-800 sm:w-auto dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"><BriefcaseBusiness className="mr-2 h-4 w-4" />{starting ? c.preparing : c.continue}<ArrowRight className="ml-2 h-4 w-4" /></Button>
              </div>
            </section>
            <button type="button" onClick={() => setActiveTab('profile')} className="flex w-full items-center gap-4 border-t px-1 py-4 text-left transition-colors hover:text-foreground"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${pendingFields ? 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'}`}>{pendingFields ? <FilePenLine className="h-4 w-4" /> : <Check className="h-4 w-4" />}</span><span><span className="block text-sm font-medium">{pendingFields ? interpolate(c.profileNeeds, { count: pendingFields }) : c.profileReady}</span><span className="mt-1 block text-xs text-muted-foreground">{c.completeProfile}<ChevronRight className="ml-1 inline h-3 w-3" /></span></span></button>
          </TabsContent>

           <TabsContent value="profile" className="mt-0"><section className="rounded-lg border bg-card"><div className="flex flex-col gap-4 border-b px-5 py-5 sm:flex-row sm:items-start sm:justify-between md:px-6"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">{c.profileSettings}</p><h2 className="mt-1 text-base font-semibold">{c.profileTitle}</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{c.profileHint}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={handleAiFill} disabled={!selectedResumeId || aiFilling}>{aiFilling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}{aiFilling ? c.filling : c.aiFill}</Button><Button size="sm" onClick={handleSave} disabled={!profile || saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}{saving ? c.saving : saveDone ? c.saved : c.save}</Button></div></div><div className="px-5 py-6 md:px-6">{profileLoading || !profile ? <div className="py-16 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" />{c.loading}</div> : <ProfileEditor profile={profile} copy={c} updateProfile={updateProfile} />}</div></section></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function WorkflowStep({ number, title, hint, complete, children }: { number: string; title: string; hint: string; complete: boolean; children: React.ReactNode }) { return <div className="p-5 md:p-6"><div className="mb-5 flex items-start gap-3"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${complete ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'bg-muted text-muted-foreground'}`}>{complete ? <Check className="h-3.5 w-3.5" /> : number}</span><div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{hint}</p></div></div>{children}</div>; }
function ProfileEditor({ profile, copy: c, updateProfile }: { profile: ApplicationProfile; copy: Record<string, string>; updateProfile: (profile: ApplicationProfile) => void }) { const updatePersonal = (key: string, value: string) => updateProfile({ ...profile, personal: { ...profile.personal, [key]: value } }); const updateLinks = (key: string, value: string) => updateProfile({ ...profile, links: { ...profile.links, [key]: value } }); const fieldLabel = (field: string) => c[`field${field.charAt(0).toUpperCase()}${field.slice(1)}`] || field; return <div className="space-y-8"><ProfileSection title={c.education}>{profile.education.length ? <div className="space-y-3">{profile.education.map((entry, index) => <Textarea key={index} rows={2} value={entry.raw || ''} onChange={(event) => updateProfile({ ...profile, education: profile.education.map((item, itemIndex) => itemIndex === index ? { ...item, raw: event.target.value } : item) })} />)}</div> : <EmptyText text={c.emptyEducation} />}</ProfileSection><ProfileSection title={c.experience}>{profile.experience.length ? <div className="space-y-3">{profile.experience.map((entry, index) => <Textarea key={index} rows={3} value={entry.raw || ''} onChange={(event) => updateProfile({ ...profile, experience: profile.experience.map((item, itemIndex) => itemIndex === index ? { ...item, raw: event.target.value } : item) })} />)}</div> : <EmptyText text={c.emptyExperience} />}</ProfileSection><ProfileSection title={c.personal}><div className="grid gap-4 sm:grid-cols-2">{PERSONAL_FIELDS.map((field) => <label key={field.key} className="space-y-1.5"><span className="text-sm font-medium">{fieldLabel(field.label)}</span><Input value={profile.personal[field.key] || ''} placeholder={field.placeholder} onChange={(event) => updatePersonal(field.key, event.target.value)} /></label>)}</div></ProfileSection><ProfileSection title={c.links}><div className="grid gap-4 sm:grid-cols-3">{LINK_FIELDS.map((field) => <label key={field.key} className="space-y-1.5"><span className="text-sm font-medium">{fieldLabel(field.label)}</span><Input value={profile.links[field.key] || ''} placeholder={field.placeholder} onChange={(event) => updateLinks(field.key, event.target.value)} /></label>)}</div></ProfileSection><ProfileSection title={c.skills}><div className="space-y-4"><Input value={(profile.skills || []).join(', ')} placeholder={c.skillsPlaceholder} onChange={(event) => updateProfile({ ...profile, skills: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} /><div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1.5"><span className="text-sm font-medium">{c.authorization}</span><Input value={profile.workAuthorization || ''} onChange={(event) => updateProfile({ ...profile, workAuthorization: event.target.value })} /></label><label className="space-y-1.5"><span className="text-sm font-medium">{c.visa}</span><Input value={profile.visaStatus || ''} onChange={(event) => updateProfile({ ...profile, visaStatus: event.target.value })} /></label></div><label className="block space-y-1.5"><span className="text-sm font-medium">{c.summary}</span><Textarea rows={4} value={profile.summary || ''} placeholder={c.summaryPlaceholder} onChange={(event) => updateProfile({ ...profile, summary: event.target.value })} /></label></div></ProfileSection></div>; }
function ProfileSection({ title, children }: { title: string; children: React.ReactNode }) { return <section><h3 className="mb-3 text-sm font-semibold">{title}</h3>{children}</section>; }
function EmptyText({ text }: { text: string }) { return <p className="text-sm leading-6 text-muted-foreground">{text}</p>; }
export default function FieldMappingsPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/auto-apply?tab=profile'); }, [router]);
  return null;
}
