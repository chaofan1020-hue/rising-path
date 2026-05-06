'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  Upload, 
  FileText, 
  Trash2, 
  Loader2, 
  CheckCircle,
  Sparkles,
  ArrowRight,
  Edit3,
  Save,
  X,
  Plus,
  User,
  Mail,
  Phone,
  MapPin,
  GraduationCap,
  Briefcase,
  Wrench,
} from 'lucide-react';
import { AccessGuard, useAccessCode } from '@/components/access-guard';
import { StepProgressBar } from '@/components/step-progress-bar';

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

// Editable Fields Component
function EditableParsedFields({ 
  fields, 
  onChange,
  onSave,
  saving,
}: { 
  fields: ParsedFields; 
  onChange: (fields: ParsedFields) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const startEdit = (field: string, value: string) => {
    setEditingField(field);
    setEditValue(value);
  };

  const saveEdit = (field: string) => {
    const newFields = { ...fields };
    if (field === 'name') newFields.name = editValue;
    else if (field === 'email') newFields.email = editValue;
    else if (field === 'phone') newFields.phone = editValue;
    else if (field === 'location') newFields.location = editValue;
    else if (field === 'summary') newFields.summary = editValue;
    onChange(newFields);
    setEditingField(null);
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue('');
  };

  // Education editing
  const [editingEduIndex, setEditingEduIndex] = useState<number | null>(null);
  const [eduDraft, setEduDraft] = useState<{ school: string; degree: string; major: string; duration: string; gpa: string }>({ school: '', degree: '', major: '', duration: '', gpa: '' });

  const startEduEdit = (index: number) => {
    const edu = fields.education?.[index];
    if (edu) {
      setEduDraft({ school: edu.school, degree: edu.degree, major: edu.major, duration: edu.duration || '', gpa: edu.gpa || '' });
      setEditingEduIndex(index);
    }
  };

  const saveEduEdit = () => {
    if (editingEduIndex === null) return;
    const newFields = { ...fields };
    if (newFields.education) {
      newFields.education[editingEduIndex] = { ...eduDraft };
      onChange(newFields);
    }
    setEditingEduIndex(null);
  };

  // Experience editing
  const [editingExpIndex, setEditingExpIndex] = useState<number | null>(null);
  const [expDraft, setExpDraft] = useState<{ company: string; title: string; duration: string; highlights: string }>({ company: '', title: '', duration: '', highlights: '' });

  const startExpEdit = (index: number) => {
    const exp = fields.experience?.[index];
    if (exp) {
      setExpDraft({ company: exp.company, title: exp.title, duration: exp.duration || '', highlights: exp.highlights?.join('\n') || '' });
      setEditingExpIndex(index);
    }
  };

  const saveExpEdit = () => {
    if (editingExpIndex === null) return;
    const newFields = { ...fields };
    if (newFields.experience) {
      newFields.experience[editingExpIndex] = {
        ...expDraft,
        highlights: expDraft.highlights ? expDraft.highlights.split('\n').filter(Boolean) : undefined,
      };
      onChange(newFields);
    }
    setEditingExpIndex(null);
  };

  // Skills editing
  const [editingSkillType, setEditingSkillType] = useState<string | null>(null);
  const [skillDraft, setSkillDraft] = useState('');

  const startSkillEdit = (type: string) => {
    const skills = type === 'technical' ? fields.skills?.technical : type === 'languages' ? fields.skills?.languages : fields.skills?.tools;
    setSkillDraft(skills?.join(', ') || '');
    setEditingSkillType(type);
  };

  const saveSkillEdit = () => {
    if (!editingSkillType) return;
    const newFields = { ...fields, skills: { ...fields.skills } };
    const arr = skillDraft.split(',').map(s => s.trim()).filter(Boolean);
    if (editingSkillType === 'technical') newFields.skills!.technical = arr;
    else if (editingSkillType === 'languages') newFields.skills!.languages = arr;
    else if (editingSkillType === 'tools') newFields.skills!.tools = arr;
    onChange(newFields);
    setEditingSkillType(null);
  };

  const renderEditableField = (label: string, field: string, value: string | undefined, icon: React.ReactNode) => {
    if (!value) return null;
    return (
      <div className="flex items-center gap-2 group">
        {icon}
        <span className="text-muted-foreground text-sm w-12 flex-shrink-0">{label}:</span>
        {editingField === field ? (
          <div className="flex items-center gap-1 flex-1">
            <Input value={editValue} onChange={e => setEditValue(e.target.value)} className="h-7 text-sm" autoFocus onKeyDown={e => { if (e.key === 'Enter') saveEdit(field); if (e.key === 'Escape') cancelEdit(); }} />
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => saveEdit(field)}><CheckCircle className="h-3.5 w-3.5 text-green-600" /></Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={cancelEdit}><X className="h-3.5 w-3.5" /></Button>
          </div>
        ) : (
          <div className="flex items-center gap-1 flex-1">
            <span className="font-medium text-sm">{value}</span>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => startEdit(field, value)}>
              <Edit3 className="h-3 w-3 text-muted-foreground" />
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Basic Info */}
      <div>
        <h4 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5"><User className="h-4 w-4" /> 基本信息</h4>
        <div className="space-y-2 pl-6">
          {renderEditableField('姓名', 'name', fields.name, <User className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />)}
          {renderEditableField('邮箱', 'email', fields.email, <Mail className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />)}
          {renderEditableField('电话', 'phone', fields.phone, <Phone className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />)}
          {renderEditableField('地址', 'location', fields.location, <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />)}
        </div>
      </div>

      {/* Education */}
      {fields.education && fields.education.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5"><GraduationCap className="h-4 w-4" /> 教育背景</h4>
          <div className="space-y-2 pl-6">
            {fields.education.map((edu, i) => (
              <div key={i} className="group">
                {editingEduIndex === i ? (
                  <div className="space-y-2 p-2 rounded-lg bg-muted/30">
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder="学校" value={eduDraft.school} onChange={e => setEduDraft({...eduDraft, school: e.target.value})} className="h-7 text-sm" />
                      <Input placeholder="学位" value={eduDraft.degree} onChange={e => setEduDraft({...eduDraft, degree: e.target.value})} className="h-7 text-sm" />
                      <Input placeholder="专业" value={eduDraft.major} onChange={e => setEduDraft({...eduDraft, major: e.target.value})} className="h-7 text-sm" />
                      <Input placeholder="时间" value={eduDraft.duration} onChange={e => setEduDraft({...eduDraft, duration: e.target.value})} className="h-7 text-sm" />
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={saveEduEdit}><CheckCircle className="h-3.5 w-3.5 text-green-600 mr-1" />保存</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingEduIndex(null)}>取消</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-1">
                    <span className="text-sm"><strong>{edu.school}</strong> - {edu.degree} {edu.major} {edu.duration && <span className="text-muted-foreground">({edu.duration})</span>} {edu.gpa && <span className="text-muted-foreground">GPA: {edu.gpa}</span>}</span>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" onClick={() => startEduEdit(i)}>
                      <Edit3 className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Experience */}
      {fields.experience && fields.experience.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5"><Briefcase className="h-4 w-4" /> 工作经历</h4>
          <div className="space-y-2 pl-6">
            {fields.experience.map((exp, i) => (
              <div key={i} className="group">
                {editingExpIndex === i ? (
                  <div className="space-y-2 p-2 rounded-lg bg-muted/30">
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder="公司" value={expDraft.company} onChange={e => setExpDraft({...expDraft, company: e.target.value})} className="h-7 text-sm" />
                      <Input placeholder="职位" value={expDraft.title} onChange={e => setExpDraft({...expDraft, title: e.target.value})} className="h-7 text-sm" />
                      <Input placeholder="时间" value={expDraft.duration} onChange={e => setExpDraft({...expDraft, duration: e.target.value})} className="h-7 text-sm" />
                    </div>
                    <Textarea placeholder="工作内容（每行一条）" value={expDraft.highlights} onChange={e => setExpDraft({...expDraft, highlights: e.target.value})} className="text-sm min-h-[60px]" />
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={saveExpEdit}><CheckCircle className="h-3.5 w-3.5 text-green-600 mr-1" />保存</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingExpIndex(null)}>取消</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-1">
                    <div className="text-sm">
                      <strong>{exp.company}</strong> - {exp.title} {exp.duration && <span className="text-muted-foreground">({exp.duration})</span>}
                      {exp.highlights && (
                        <ul className="mt-1 ml-3 space-y-0.5 text-muted-foreground text-xs">
                          {exp.highlights.map((h, j) => <li key={j}>• {h}</li>)}
                        </ul>
                      )}
                    </div>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" onClick={() => startExpEdit(i)}>
                      <Edit3 className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Skills */}
      {fields.skills && (
        <div>
          <h4 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5"><Wrench className="h-4 w-4" /> 技能</h4>
          <div className="space-y-2 pl-6">
            {fields.skills.technical && fields.skills.technical.length > 0 && (
              <div className="group">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-muted-foreground">技术技能:</span>
                  <Button size="sm" variant="ghost" className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100" onClick={() => startSkillEdit('technical')}><Edit3 className="h-2.5 w-2.5" /></Button>
                </div>
                {editingSkillType === 'technical' ? (
                  <div className="flex items-center gap-1">
                    <Input value={skillDraft} onChange={e => setSkillDraft(e.target.value)} className="h-7 text-sm" placeholder="逗号分隔" onKeyDown={e => { if (e.key === 'Enter') saveSkillEdit(); }} />
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={saveSkillEdit}><CheckCircle className="h-3.5 w-3.5 text-green-600" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingSkillType(null)}><X className="h-3.5 w-3.5" /></Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {fields.skills.technical.map((s, i) => <Badge key={i} variant="secondary" className="text-xs">{s}</Badge>)}
                  </div>
                )}
              </div>
            )}
            {fields.skills.languages && fields.skills.languages.length > 0 && (
              <div className="group">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-muted-foreground">语言:</span>
                  <Button size="sm" variant="ghost" className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100" onClick={() => startSkillEdit('languages')}><Edit3 className="h-2.5 w-2.5" /></Button>
                </div>
                {editingSkillType === 'languages' ? (
                  <div className="flex items-center gap-1">
                    <Input value={skillDraft} onChange={e => setSkillDraft(e.target.value)} className="h-7 text-sm" placeholder="逗号分隔" onKeyDown={e => { if (e.key === 'Enter') saveSkillEdit(); }} />
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={saveSkillEdit}><CheckCircle className="h-3.5 w-3.5 text-green-600" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingSkillType(null)}><X className="h-3.5 w-3.5" /></Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {fields.skills.languages.map((s, i) => <Badge key={i} variant="outline" className="text-xs">{s}</Badge>)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Summary */}
      {fields.summary && (
        <div>
          <h4 className="text-sm font-semibold text-muted-foreground mb-2">个人总结</h4>
          <div className="pl-6 group">
            {editingField === 'summary' ? (
              <div className="space-y-1">
                <Textarea value={editValue} onChange={e => setEditValue(e.target.value)} className="text-sm min-h-[60px]" autoFocus />
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => saveEdit('summary')}><CheckCircle className="h-3.5 w-3.5 text-green-600 mr-1" />保存</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={cancelEdit}>取消</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-1">
                <p className="text-sm text-muted-foreground">{fields.summary}</p>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" onClick={() => startEdit('summary', fields.summary || '')}>
                  <Edit3 className="h-3 w-3 text-muted-foreground" />
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="flex justify-end pt-2 border-t">
        <Button onClick={onSave} disabled={saving} size="sm">
          {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
          保存修改
        </Button>
      </div>
    </div>
  );
}

// Main Content
function ResumeContent() {
  const router = useRouter();
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedResume, setSelectedResume] = useState<Resume | null>(null);
  const [extractingId, setExtractingId] = useState<number | null>(null);
  const [savingFields, setSavingFields] = useState(false);
  const [editedFields, setEditedFields] = useState<ParsedFields | null>(null);
  const { accessCodeId } = useAccessCode();

  const extractFields = async (resume: Resume) => {
    setExtractingId(resume.id);
    try {
      const response = await fetch('/api/resume/extract-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume_id: resume.id, access_code_id: accessCodeId }),
      });
      const data = await response.json();
      if (data.success && data.parsed_fields) {
        const updatedResume = { ...resume, parsed_fields: data.parsed_fields };
        setResumes(resumes.map(r => r.id === resume.id ? updatedResume : r));
        if (selectedResume?.id === resume.id) {
          setSelectedResume(updatedResume);
          setEditedFields(data.parsed_fields);
        }
      }
    } catch (error) {
      console.error('Extract failed:', error);
    } finally {
      setExtractingId(null);
    }
  };

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
  }, []);

  const handleUpload = async () => {
    if (!selectedFile || !accessCodeId) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('access_code_id', accessCodeId.toString());
      const progressInterval = setInterval(() => setUploadProgress(prev => Math.min(prev + 10, 90)), 200);
      const response = await fetch('/api/resume', { method: 'POST', body: formData });
      clearInterval(progressInterval);
      setUploadProgress(100);
      const data = await response.json();
      if (data.resume) {
        setTimeout(() => fetchResumes(), 3000);
        setSelectedFile(null);
        setUploadProgress(0);
      }
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
    }
  };

  const fetchResumes = async () => {
    setLoading(true);
    try {
      if (!accessCodeId) { setResumes([]); return; }
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
    if (!confirm('确定要删除这份简历吗？')) return;
    try {
      const response = await fetch(`/api/resume/${id}`, { method: 'DELETE' });
      if (response.ok) {
        setResumes(resumes.filter(r => r.id !== id));
        if (selectedResume?.id === id) setSelectedResume(null);
      }
    } catch (error) {
      console.error('Failed to delete:', error);
    }
  };

  const saveParsedFields = async () => {
    if (!selectedResume || !editedFields) return;
    setSavingFields(true);
    try {
      const response = await fetch('/api/resume/update-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resume_id: selectedResume.id,
          parsed_fields: editedFields,
        }),
      });
      const data = await response.json();
      if (data.success) {
        setResumes(resumes.map(r => r.id === selectedResume.id ? { ...r, parsed_fields: editedFields } : r));
        setSelectedResume(prev => prev ? { ...prev, parsed_fields: editedFields } : prev);
      }
    } catch (error) {
      console.error('Save failed:', error);
    } finally {
      setSavingFields(false);
    }
  };

  useEffect(() => {
    if (accessCodeId) fetchResumes();
  }, [accessCodeId]);

  // Auto-extract fields for resumes that don't have them yet
  useEffect(() => {
    if (resumes.length > 0) {
      const unextracted = resumes.find(r => r.parsed_content && !r.parsed_content.includes('正在解析') && !r.parsed_fields);
      if (unextracted) extractFields(unextracted);
    }
  }, [resumes.length]);

  const hasActiveResume = resumes.some(r => r.parsed_fields);

  return (
    <div className="min-h-screen bg-background">
      <StepProgressBar currentStep="resume" />

      <main className="container mx-auto px-4 py-4 md:py-8">
        {/* Page Title */}
        <div className="mb-4 md:mb-6">
          <h1 className="text-xl md:text-2xl font-bold mb-1">Step 1: 提供简历</h1>
          <p className="text-sm text-muted-foreground">上传简历，AI自动解析后你可以编辑确认，完成后进入下一步</p>
        </div>

        {/* Upload Section */}
        <Card className="mb-4 md:mb-6">
          <CardHeader className="pb-2 md:pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4" />
              上传简历
            </CardTitle>
            <CardDescription className="text-xs">
              支持 PDF、Word (.docx)、TXT 格式，系统自动解析提取关键信息
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex flex-col md:flex-row gap-3">
                <Input
                  type="file"
                  accept=".pdf,.doc,.docx,.txt"
                  onChange={handleFileSelect}
                  disabled={uploading}
                  className="text-sm h-10 flex-1"
                />
                <Button onClick={handleUpload} disabled={!selectedFile || uploading} className="w-full md:w-auto h-10">
                  {uploading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />上传中...</>
                  ) : (
                    <><Upload className="mr-2 h-4 w-4" />上传简历</>
                  )}
                </Button>
              </div>
              {selectedFile && <p className="text-xs text-muted-foreground">已选择: {selectedFile.name}</p>}
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
        {loading ? (
          <div className="text-center py-12 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
            加载中...
          </div>
        ) : resumes.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>暂无简历，上传你的第一份简历开始求职之旅</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">我的简历</h2>
            {resumes.map((resume) => (
              <Card key={resume.id} className={`transition-all ${selectedResume?.id === resume.id ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-md'}`}>
                <CardContent className="pt-4">
                  <div className="flex flex-col gap-3">
                    {/* File info row */}
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${resume.parsed_fields ? 'bg-green-100 dark:bg-green-900' : 'bg-yellow-100 dark:bg-yellow-900'}`}>
                        {resume.parsed_fields ? (
                          <CheckCircle className="h-5 w-5 text-green-600" />
                        ) : (
                          <Loader2 className="h-5 w-5 text-yellow-600 animate-spin" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm truncate">{resume.file_name}</h3>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          <Badge variant="secondary" className="text-xs">{new Date(resume.created_at).toLocaleDateString()}</Badge>
                          {resume.parsed_fields?.name && <Badge variant="outline" className="text-xs">{resume.parsed_fields.name}</Badge>}
                          {resume.parsed_fields?.email && <Badge variant="outline" className="text-xs">{resume.parsed_fields.email}</Badge>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {!resume.parsed_fields && resume.parsed_content && !resume.parsed_content.includes('正在解析') && (
                          <Button variant="outline" size="sm" className="text-xs h-8" onClick={() => extractFields(resume)} disabled={extractingId === resume.id}>
                            {extractingId === resume.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                            提取字段
                          </Button>
                        )}
                        <Button
                          variant={selectedResume?.id === resume.id ? 'default' : 'outline'}
                          size="sm"
                          className="text-xs h-8"
                          onClick={() => {
                            setSelectedResume(resume);
                            setEditedFields(resume.parsed_fields || null);
                          }}
                        >
                          {selectedResume?.id === resume.id ? '已选中' : '选择'}
                        </Button>
                        <Button variant="ghost" size="sm" className="text-xs h-8 text-destructive" onClick={() => deleteResume(resume.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Selected resume: show editable fields */}
                    {selectedResume?.id === resume.id && editedFields && (
                      <div className="mt-2 pt-3 border-t bg-gradient-to-r from-primary/5 to-transparent p-3 rounded-lg">
                        <div className="flex items-center gap-2 mb-3">
                          <Sparkles className="h-4 w-4 text-primary" />
                          <span className="font-medium text-sm">AI 解析结果（可编辑）</span>
                          <Badge variant="secondary" className="text-xs">点击编辑</Badge>
                        </div>
                        <EditableParsedFields
                          fields={editedFields}
                          onChange={setEditedFields}
                          onSave={saveParsedFields}
                          saving={savingFields}
                        />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Next Step Button */}
        {hasActiveResume && (
          <div className="mt-6 flex justify-end">
            <Button
              size="lg"
              className="bg-gradient-to-r from-primary to-primary/80 shadow-lg shadow-primary/20 group"
              onClick={() => router.push('/ai-match')}
            >
              下一步：AI选岗
              <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}

export default function ResumePage() {
  return (
    <AccessGuard>
      <ResumeContent />
    </AccessGuard>
  );
}
