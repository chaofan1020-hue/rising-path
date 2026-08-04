'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  Sparkles, 
  FileText, 
  Loader2, 
  CheckCircle, 
  Copy, 
  Download,
  Target,
  AlertCircle,
  Languages,
  Save,
  Clock,
  Trash2,
  Pencil,
  Eye,
} from 'lucide-react';
import Link from 'next/link';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import { saveAs } from 'file-saver';
import { AccessGuard, useAccessCode } from '@/components/access-guard';
import { Header1 } from '@/components/header1';
import { useLanguage } from '@/lib/language-context';

interface Resume {
  id: number;
  file_name: string;
  parsed_content: string;
  user_info: Record<string, unknown>;
}

// 优化记录历史
interface OptimizedRecord {
  id: string;
  resumeId: string;
  resumeName: string;
  targetCompany: string;
  targetPosition: string;
  resumeData: ResumeData;
  isEnglish: boolean;
  createdAt: string;
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

// 将 ResumeData 转换为可读的纯文本
const resumeDataToText = (data: ResumeData, isEnglish?: boolean): string => {
  const labels = {
    summary: isEnglish ? 'Summary' : '个人简介',
    skills: isEnglish ? 'Skills' : '专业技能',
    experience: isEnglish ? 'Experience' : '工作经历',
    education: isEnglish ? 'Education' : '教育背景',
    projects: isEnglish ? 'Projects' : '项目经历',
    certifications: isEnglish ? 'Certifications' : '证书资质',
  };
  
  let text = '';
  text += `${data.name}\n`;
  const contacts: string[] = [];
  if (data.contact.email) contacts.push(data.contact.email);
  if (data.contact.phone) contacts.push(data.contact.phone);
  if (data.contact.location) contacts.push(data.contact.location);
  if (data.contact.linkedin) contacts.push(data.contact.linkedin);
  if (contacts.length > 0) text += `${contacts.join(' | ')}\n`;
  text += '\n';

  if (data.summary) {
    text += `【${labels.summary}】\n${data.summary}\n\n`;
  }
  if (data.skills && data.skills.length > 0) {
    text += `【${labels.skills}】\n${data.skills.join('、')}\n\n`;
  }
  if (data.experience && data.experience.length > 0) {
    text += `【${labels.experience}】\n`;
    data.experience.forEach(exp => {
      text += `${exp.title} | ${exp.company}${exp.location ? ` | ${exp.location}` : ''} | ${exp.period}\n`;
      exp.highlights.forEach(h => { text += `  • ${h}\n`; });
      text += '\n';
    });
  }
  if (data.education && data.education.length > 0) {
    text += `【${labels.education}】\n`;
    data.education.forEach(edu => {
      text += `${edu.degree} | ${edu.school}${edu.major ? ` | ${edu.major}` : ''} | ${edu.period}`;
      if (edu.gpa) text += ` | GPA: ${edu.gpa}`;
      text += '\n';
    });
    text += '\n';
  }
  if (data.projects && data.projects.length > 0) {
    text += `【${labels.projects}】\n`;
    data.projects.forEach(proj => {
      text += `${proj.name}${proj.role ? ` | ${proj.role}` : ''}${proj.period ? ` | ${proj.period}` : ''}\n`;
      if (proj.description) text += `  ${proj.description}\n`;
      proj.highlights.forEach(h => { text += `  • ${h}\n`; });
      text += '\n';
    });
  }
  if (data.certifications && data.certifications.length > 0) {
    text += `【${labels.certifications}】\n${data.certifications.join('\n')}\n`;
  }
  return text.trim();
};

// 简历预览组件
const ResumePreview = ({ data, isEnglish }: { data: ResumeData; isEnglish?: boolean }) => {
  const labels = {
    summary: isEnglish ? 'Summary' : '个人简介',
    skills: isEnglish ? 'Skills' : '专业技能',
    experience: isEnglish ? 'Experience' : '工作经历',
    education: isEnglish ? 'Education' : '教育背景',
    projects: isEnglish ? 'Projects' : '项目经历',
    certifications: isEnglish ? 'Certifications' : '证书资质',
  };
  
  return (
    <div className="bg-white text-black p-4 md:p-8 shadow-lg rounded-lg">
      {/* 头部：姓名和联系方式 */}
      <div className="text-center border-b-2 border-gray-800 pb-3 md:pb-4 mb-3 md:mb-4">
        <h1 className="text-lg md:text-2xl font-bold text-gray-900 mb-1 md:mb-2">{data.name || (isEnglish ? 'Name' : '姓名')}</h1>
        <div className="flex flex-wrap justify-center gap-2 md:gap-4 text-xs md:text-sm text-gray-600">
          {data.contact?.email && <span>{data.contact.email}</span>}
          {data.contact?.phone && <span>{data.contact.phone}</span>}
          {data.contact?.location && <span>{data.contact.location}</span>}
          {data.contact?.linkedin && <span>{data.contact.linkedin}</span>}
        </div>
      </div>

      {/* 个人简介 */}
      {data.summary && (
        <div className="mb-3 md:mb-4">
          <h2 className="text-xs md:text-sm font-bold text-gray-800 uppercase tracking-wide border-b border-gray-300 pb-1 mb-1.5 md:mb-2">
            {labels.summary}
          </h2>
          <p className="text-xs md:text-sm text-gray-700 leading-relaxed">{data.summary}</p>
        </div>
      )}

      {/* 技能 */}
      {data.skills && data.skills.length > 0 && (
        <div className="mb-3 md:mb-4">
          <h2 className="text-xs md:text-sm font-bold text-gray-800 uppercase tracking-wide border-b border-gray-300 pb-1 mb-1.5 md:mb-2">
            {labels.skills}
          </h2>
          <div className="flex flex-wrap gap-1.5 md:gap-2">
            {data.skills.map((skill, index) => (
              <span key={index} className="text-xs md:text-sm bg-gray-100 px-1.5 md:px-2 py-0.5 md:py-1 rounded text-gray-700">
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 工作经历 */}
      {data.experience && data.experience.length > 0 && (
        <div className="mb-3 md:mb-4">
          <h2 className="text-xs md:text-sm font-bold text-gray-800 uppercase tracking-wide border-b border-gray-300 pb-1 mb-1.5 md:mb-2">
            {labels.experience}
          </h2>
          <div className="space-y-2 md:space-y-3">
            {data.experience.map((exp, index) => (
              <div key={index}>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start mb-1 gap-0.5 sm:gap-0">
                  <div>
                    <span className="font-semibold text-gray-900 text-xs md:text-sm">{exp.title}</span>
                    <span className="text-gray-600 mx-1 md:mx-2 text-xs md:text-sm">|</span>
                    <span className="text-gray-700 text-xs md:text-sm">{exp.company}</span>
                    {exp.location && (
                      <>
                        <span className="text-gray-400 mx-0.5 md:mx-1">·</span>
                        <span className="text-gray-500 text-xs md:text-sm">{exp.location}</span>
                      </>
                    )}
                  </div>
                  <span className="text-xs text-gray-500 whitespace-nowrap">{exp.period}</span>
                </div>
                <ul className="list-disc list-inside text-xs md:text-sm text-gray-700 space-y-0.5 md:space-y-1 ml-2">
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
        <div className="mb-3 md:mb-4">
          <h2 className="text-xs md:text-sm font-bold text-gray-800 uppercase tracking-wide border-b border-gray-300 pb-1 mb-1.5 md:mb-2">
            {labels.education}
          </h2>
          <div className="space-y-1.5 md:space-y-2">
            {data.education.map((edu, index) => (
              <div key={index} className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-0.5 sm:gap-0">
                <div className="text-xs md:text-sm">
                  <span className="font-semibold text-gray-900">{edu.degree}</span>
                  {edu.major && <span className="text-gray-600 mx-1">{isEnglish ? 'in' : '，'}{edu.major}</span>}
                  <span className="text-gray-400 mx-1 md:mx-2">|</span>
                  <span className="text-gray-700">{edu.school}</span>
                  {edu.gpa && <span className="text-gray-500 ml-1 md:ml-2">GPA: {edu.gpa}</span>}
                </div>
                <span className="text-xs text-gray-500 whitespace-nowrap">{edu.period}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 项目经历 */}
      {data.projects && data.projects.length > 0 && (
        <div className="mb-3 md:mb-4">
          <h2 className="text-xs md:text-sm font-bold text-gray-800 uppercase tracking-wide border-b border-gray-300 pb-1 mb-1.5 md:mb-2">
            {labels.projects}
          </h2>
          <div className="space-y-2 md:space-y-3">
            {data.projects.map((project, index) => (
              <div key={index}>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start mb-1 gap-0.5 sm:gap-0">
                  <div className="text-xs md:text-sm">
                    <span className="font-semibold text-gray-900">{project.name}</span>
                    {project.role && (
                      <>
                        <span className="text-gray-400 mx-1 md:mx-2">|</span>
                        <span className="text-gray-700">{project.role}</span>
                      </>
                    )}
                  </div>
                  {project.period && <span className="text-xs text-gray-500 whitespace-nowrap">{project.period}</span>}
                </div>
                {project.description && (
                  <p className="text-xs md:text-sm text-gray-600 mb-1">{project.description}</p>
                )}
                <ul className="list-disc list-inside text-xs md:text-sm text-gray-700 space-y-0.5 md:space-y-1 ml-2">
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
        <div className="mb-3 md:mb-4">
          <h2 className="text-xs md:text-sm font-bold text-gray-800 uppercase tracking-wide border-b border-gray-300 pb-1 mb-1.5 md:mb-2">
            {labels.certifications}
          </h2>
          <div className="flex flex-wrap gap-x-3 md:gap-x-4 gap-y-0.5 md:gap-y-1">
            {data.certifications.map((cert, index) => (
              <span key={index} className="text-xs md:text-sm text-gray-700">
                • {cert}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// 内部组件
function OptimizeContent() {
  const searchParams = useSearchParams();
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<string>('');
  const [targetCompany, setTargetCompany] = useState('');
  const [targetPosition, setTargetPosition] = useState('');
  const [targetRegion, setTargetRegion] = useState('');
  const [suggestions, setSuggestions] = useState('');
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeProgress, setOptimizeProgress] = useState(0);
  const [optimizedContent, setOptimizedContent] = useState('');
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [originalContent, setOriginalContent] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [isEnglishVersion, setIsEnglishVersion] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [savedRecords, setSavedRecords] = useState<OptimizedRecord[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [showSavedToast, setShowSavedToast] = useState(false);
  const { accessCodeId } = useAccessCode();
  const { t } = useLanguage();

  // 地区列表
  const regionList = [
    { value: 'us', label: t('optimize.regionUs') },
    { value: 'uk', label: t('optimize.regionUk') },
    { value: 'sg', label: t('optimize.regionSg') },
    { value: 'hk', label: t('optimize.regionHk') },
    { value: 'au', label: t('optimize.regionAu') },
    { value: 'ca', label: t('optimize.regionCa') },
    { value: 'eu', label: t('optimize.regionEu') },
    { value: 'cn', label: t('optimize.regionCn') },
    { value: 'jp', label: t('optimize.regionJp') },
  ];

  // 获取当前访问码的存储key
  const getStorageKey = () => `optimized_records_${accessCodeId || 'default'}`;

  // 加载历史记录（按访问码隔离）
  useEffect(() => {
    const saved = localStorage.getItem(getStorageKey());
    if (saved) {
      try {
        setSavedRecords(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse saved records:', e);
      }
    }
  }, [accessCodeId]);

  // 保存到本地存储
  const handleSave = () => {
    if (!resumeData || !selectedResumeId) return;
    
    const record: OptimizedRecord = {
      id: Date.now().toString(),
      resumeId: selectedResumeId,
      resumeName: resumes.find(r => r.id.toString() === selectedResumeId)?.file_name || t('optimize.unknownResume'),
      targetCompany,
      targetPosition,
      resumeData,
      isEnglish: isEnglishVersion,
      createdAt: new Date().toISOString(),
    };
    
    const newRecords = [record, ...savedRecords].slice(0, 20); // 最多保存20条
    setSavedRecords(newRecords);
    localStorage.setItem(getStorageKey(), JSON.stringify(newRecords));
    setShowSavedToast(true);
    setTimeout(() => setShowSavedToast(false), 2000);
  };

  // JD搜索相关状态
  const [searchingJD, setSearchingJD] = useState(false);
  const [jdContent, setJdContent] = useState('');
  const [jdResults, setJdResults] = useState<Array<{title: string; siteName: string; url: string; snippet: string}>>([]);

  // 获取岗位描述
  const handleSearchJD = async () => {
    if (!targetCompany || !targetPosition) {
      alert(t('optimize.alertFillFirst'));
      return;
    }

    setSearchingJD(true);
    try {
      const regionName = regionList.find(r => r.value === targetRegion)?.label || t('optimize.regionUs');
      const response = await fetch('/api/jobs/search-jd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: targetCompany,
          position: targetPosition,
          region: targetRegion,
        }),
      });
      const data = await response.json();
      
      if (data.success) {
        setJdContent(data.jdContent || '');
        setJdResults(data.results || []);
        setSuggestions(data.summary || '');
      } else {
        alert(data.error || t('optimize.alertJdFailed'));
      }
    } catch (error) {
      console.error('Search JD failed:', error);
      alert(t('optimize.alertJdRetry'));
    } finally {
      setSearchingJD(false);
    }
  };

  // 加载历史记录
  const loadRecord = (record: OptimizedRecord) => {
    setSelectedResumeId(record.resumeId);
    setTargetCompany(record.targetCompany);
    setTargetPosition(record.targetPosition);
    setResumeData(record.resumeData);
    setIsEnglishVersion(record.isEnglish);
    setOptimizedContent(JSON.stringify(record.resumeData, null, 2));
    setShowResult(true);
  };

  // 删除历史记录
  const deleteRecord = (id: string) => {
    const newRecords = savedRecords.filter(r => r.id !== id);
    setSavedRecords(newRecords);
    localStorage.setItem(getStorageKey(), JSON.stringify(newRecords));
  };

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
          targetRegion,
          suggestions,
          accessCodeId,
          jdContent, // 传入获取到的岗位描述
        }),
      });

      clearInterval(progressInterval);
      setOptimizeProgress(100);

      const data = await response.json();
      setOptimizedContent(data.optimized_content || '');
      setResumeData(data.resume_data || null);
      setOriginalContent(data.original_content || '');
      setIsEnglishVersion(data.is_english || false);
      setShowResult(true);

      // 自动保存
      if (data.resume_data) {
        const record: OptimizedRecord = {
          id: Date.now().toString(),
          resumeId: selectedResumeId,
          resumeName: resumes.find(r => r.id.toString() === selectedResumeId)?.file_name || t('optimize.unknownResume'),
          targetCompany,
          targetPosition,
          resumeData: data.resume_data,
          isEnglish: data.is_english || false,
          createdAt: new Date().toISOString(),
        };
        const newRecords = [record, ...savedRecords].slice(0, 20);
        setSavedRecords(newRecords);
        localStorage.setItem(getStorageKey(), JSON.stringify(newRecords));
      }

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
    // 生成纯文本格式的简历内容
    if (resumeData) {
      let text = '';
      text += `${resumeData.name || t('optimize.copyName')}\n`;
      if (resumeData.contact) {
        const contactParts = [
          resumeData.contact.email,
          resumeData.contact.phone,
          resumeData.contact.location,
          resumeData.contact.linkedin
        ].filter(Boolean);
        text += `${contactParts.join(' | ')}\n`;
      }
      text += '\n';
      
      if (resumeData.summary) {
        text += `${t('optimize.copySummary')}\n${resumeData.summary}\n\n`;
      }
      
      if (resumeData.skills && resumeData.skills.length > 0) {
        text += `${t('optimize.copySkills')}\n${resumeData.skills.join('、')}\n\n`;
      }
      
      if (resumeData.experience && resumeData.experience.length > 0) {
        text += `${t('optimize.copyExperience')}\n`;
        resumeData.experience.forEach(exp => {
          text += `${exp.title} | ${exp.company}${exp.location ? ` · ${exp.location}` : ''} | ${exp.period}\n`;
          exp.highlights.forEach(h => text += `• ${h}\n`);
          text += '\n';
        });
      }
      
      if (resumeData.education && resumeData.education.length > 0) {
        text += `${t('optimize.copyEducation')}\n`;
        resumeData.education.forEach(edu => {
          text += `${edu.degree}${edu.major ? ` in ${edu.major}` : ''} | ${edu.school} | ${edu.period}`;
          if (edu.gpa) text += ` | GPA: ${edu.gpa}`;
          text += '\n';
        });
        text += '\n';
      }
      
      if (resumeData.projects && resumeData.projects.length > 0) {
        text += `${t('optimize.copyProjects')}\n`;
        resumeData.projects.forEach(proj => {
          text += `${proj.name}${proj.role ? ` | ${proj.role}` : ''}${proj.period ? ` | ${proj.period}` : ''}\n`;
          if (proj.description) text += `${proj.description}\n`;
          proj.highlights.forEach(h => text += `• ${h}\n`);
          text += '\n';
        });
      }
      
      if (resumeData.certifications && resumeData.certifications.length > 0) {
        text += `${t('optimize.copyCertifications')}\n${resumeData.certifications.join('\n')}\n`;
      }
      
      navigator.clipboard.writeText(text.trim());
    } else {
      navigator.clipboard.writeText(isEditing ? editedContent : optimizedContent);
    }
  };

  const handleDownload = async () => {
    if (!resumeData) return;
    
    setDownloading(true);
    try {
      const children: Paragraph[] = [];
      
      // 姓名 - 标题样式
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: resumeData.name || t('optimize.copyName'),
              bold: true,
              size: 48, // 24pt
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        })
      );
      
      // 联系方式
      if (resumeData.contact) {
        const contactParts = [
          resumeData.contact.email,
          resumeData.contact.phone,
          resumeData.contact.location,
          resumeData.contact.linkedin
        ].filter(Boolean);
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: contactParts.join(' | '),
                size: 20,
                color: '666666',
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
          })
        );
      }
      
      // 个人简介
      if (resumeData.summary) {
        children.push(
          new Paragraph({
            text: t('optimize.copySummary'),
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 100 },
          })
        );
        children.push(
          new Paragraph({
            children: [new TextRun({ text: resumeData.summary, size: 22 })],
            spacing: { after: 200 },
          })
        );
      }
      
      // 专业技能
      if (resumeData.skills && resumeData.skills.length > 0) {
        children.push(
          new Paragraph({
            text: t('optimize.copySkills'),
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 100 },
          })
        );
        children.push(
          new Paragraph({
            children: [new TextRun({ text: resumeData.skills.join('、'), size: 22 })],
            spacing: { after: 200 },
          })
        );
      }
      
      // 工作经历
      if (resumeData.experience && resumeData.experience.length > 0) {
        children.push(
          new Paragraph({
            text: t('optimize.copyExperience'),
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 100 },
          })
        );
        resumeData.experience.forEach(exp => {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: exp.title, bold: true, size: 24 }),
                new TextRun({ text: ' | ', size: 22 }),
                new TextRun({ text: exp.company, size: 22 }),
                ...(exp.location ? [
                  new TextRun({ text: ' · ', size: 22, color: '999999' }),
                  new TextRun({ text: exp.location, size: 22, color: '666666' }),
                ] : []),
                new TextRun({ text: '  ', size: 22 }),
                new TextRun({ text: exp.period, size: 20, color: '666666' }),
              ],
              spacing: { before: 150, after: 50 },
            })
          );
          exp.highlights.forEach(h => {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: `• ${h}`, size: 22 })],
                spacing: { after: 30 },
                indent: { left: 360 },
              })
            );
          });
        });
      }
      
      // 教育背景
      if (resumeData.education && resumeData.education.length > 0) {
        children.push(
          new Paragraph({
            text: t('optimize.copyEducation'),
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 100 },
          })
        );
        resumeData.education.forEach(edu => {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: edu.degree, bold: true, size: 24 }),
                ...(edu.major ? [new TextRun({ text: ` in ${edu.major}`, size: 22 })] : []),
                new TextRun({ text: ' | ', size: 22 }),
                new TextRun({ text: edu.school, size: 22 }),
                ...(edu.gpa ? [new TextRun({ text: ` | GPA: ${edu.gpa}`, size: 20, color: '666666' })] : []),
                new TextRun({ text: '  ', size: 22 }),
                new TextRun({ text: edu.period, size: 20, color: '666666' }),
              ],
              spacing: { before: 100, after: 50 },
            })
          );
        });
      }
      
      // 项目经历
      if (resumeData.projects && resumeData.projects.length > 0) {
        children.push(
          new Paragraph({
            text: t('optimize.copyProjects'),
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 100 },
          })
        );
        resumeData.projects.forEach(proj => {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: proj.name, bold: true, size: 24 }),
                ...(proj.role ? [new TextRun({ text: ` | ${proj.role}`, size: 22 })] : []),
                ...(proj.period ? [new TextRun({ text: `  ${proj.period}`, size: 20, color: '666666' })] : []),
              ],
              spacing: { before: 150, after: 50 },
            })
          );
          if (proj.description) {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: proj.description, size: 22 })],
                spacing: { after: 30 },
              })
            );
          }
          proj.highlights.forEach(h => {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: `• ${h}`, size: 22 })],
                spacing: { after: 30 },
                indent: { left: 360 },
              })
            );
          });
        });
      }
      
      // 证书认证
      if (resumeData.certifications && resumeData.certifications.length > 0) {
        children.push(
          new Paragraph({
            text: t('optimize.copyCertifications'),
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 100 },
          })
        );
        resumeData.certifications.forEach(cert => {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: `• ${cert}`, size: 22 })],
              spacing: { after: 30 },
            })
          );
        });
      }
      
      // 创建文档
      const doc = new Document({
        sections: [{
          properties: {},
          children: children,
        }],
      });
      
      // 生成并下载
      const blob = await Packer.toBlob(doc);
      const fileName = `resume_${targetPosition || 'optimized'}_${new Date().toISOString().slice(0, 10)}.docx`;
      saveAs(blob, fileName);
    } catch (error) {
      console.error('Failed to generate Word document:', error);
      alert(t('optimize.alertWordFailed'));
    } finally {
      setDownloading(false);
    }
  };

  const handleTranslate = async (targetLanguage: 'chinese' | 'english') => {
    if (!resumeData) return;
    
    // 如果已经是目标语言，不需要转换
    if ((targetLanguage === 'english' && isEnglishVersion) || 
        (targetLanguage === 'chinese' && !isEnglishVersion)) {
      return;
    }
    
    setTranslating(true);
    try {
      const response = await fetch('/api/ai/translate-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resumeData,
          targetLanguage,
        }),
      });

      const data = await response.json();
      if (data.resume_data) {
        setResumeData(data.resume_data);
        setIsEnglishVersion(targetLanguage === 'english');
      }
    } catch (error) {
      console.error('Translation failed:', error);
    } finally {
      setTranslating(false);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <Header1 />
      <main className="relative container mx-auto px-4 pt-16 md:pt-20 pb-16">
        {/* Hero：左对齐 eyebrow + 大标题（Tailark 式） */}
        <div className="relative mb-8 md:mb-10">
          <p className="text-sm font-medium text-zinc-400 dark:text-zinc-500 mb-3">{t('optimize.eyebrow')}</p>
          <h1 className="text-2xl md:text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 mb-4">{t('optimize.title')}</h1>
          <p className="text-zinc-500 dark:text-zinc-400 max-w-2xl md:text-lg leading-relaxed">{t('optimize.subtitle')}</p>
        </div>

        {/* 历史记录 */}
        {savedRecords.length > 0 && (
          <Card className="relative mb-6 md:mb-8 rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none">
            <CardHeader className="pb-2 md:pb-4">
              <CardTitle className="flex items-center gap-2.5 text-base md:text-lg tracking-tight text-zinc-900 dark:text-zinc-50">
                <span className="w-7 h-7 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center">
                  <Clock className="h-4 w-4 text-white dark:text-zinc-900" />
                </span>
                {t('optimize.history')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {savedRecords.slice(0, 5).map((record) => (
                  <div
                    key={record.id}
                    className="flex items-center justify-between p-2 md:p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-100 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors cursor-pointer group"
                    onClick={() => loadRecord(record)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs md:text-sm font-medium truncate text-zinc-900 dark:text-zinc-100">
                          {record.targetPosition}
                        </span>
                        {record.targetCompany && (
                          <Badge variant="secondary" className="text-[10px] md:text-xs bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 hover:bg-zinc-100">
                            {record.targetCompany}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] md:text-xs border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400">
                          {record.isEnglish ? t('optimize.english') : t('optimize.chinese')}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] md:text-xs text-zinc-400 dark:text-zinc-500 truncate">
                          {record.resumeName}
                        </span>
                        <span className="text-[10px] md:text-xs text-zinc-400 dark:text-zinc-500">
                          {new Date(record.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteRecord(record.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Optimization Form */}
        <Card className="relative mb-6 md:mb-8 rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none">
          <CardHeader className="pb-2 md:pb-4">
            <CardTitle className="flex items-center gap-2.5 text-base md:text-lg tracking-tight text-zinc-900 dark:text-zinc-50">
              <span className="w-7 h-7 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center">
                <Target className="h-4 w-4 text-white dark:text-zinc-900" />
              </span>
              {t('optimize.settings')}
            </CardTitle>
            <CardDescription className="text-xs md:text-sm text-zinc-500 dark:text-zinc-400">
              {t('optimize.settingsDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 md:space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
              <div>
                <label className="text-xs md:text-sm font-medium mb-1.5 md:mb-2 block">{t('optimize.selectResume')}</label>
                <Select value={selectedResumeId} onValueChange={setSelectedResumeId}>
                  <SelectTrigger className="h-9 md:h-10">
                    <SelectValue placeholder={t('optimize.selectResumePlaceholder')} />
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
                <label className="text-xs md:text-sm font-medium mb-1.5 md:mb-2 block">{t('optimize.targetCompany')}</label>
                <div className="flex gap-2">
                  <Input
                    placeholder={t('optimize.targetCompanyPlaceholder')}
                    value={targetCompany}
                    onChange={(e) => setTargetCompany(e.target.value)}
                    className="h-9 md:h-10 flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSearchJD}
                    disabled={!targetCompany || !targetPosition || searchingJD}
                    className="h-9 md:h-10 px-3 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    title={t('optimize.searchJdTitle')}
                  >
                    {searchingJD ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Target className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              <div>
                <label className="text-xs md:text-sm font-medium mb-1.5 md:mb-2 block">{t('optimize.targetPosition')}</label>
                <Input
                  placeholder={t('optimize.targetPositionPlaceholder')}
                  value={targetPosition}
                  onChange={(e) => setTargetPosition(e.target.value)}
                  className="h-9 md:h-10"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-3 md:gap-4 items-end">
              <div className="w-32">
                <Select value={targetRegion} onValueChange={setTargetRegion}>
                  <SelectTrigger className="h-9 md:h-10">
                    <SelectValue placeholder={t('optimize.targetRegion')} />
                  </SelectTrigger>
                  <SelectContent>
                    {regionList.map((region) => (
                      <SelectItem key={region.value} value={region.value}>
                        {region.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleOptimize}
                disabled={!selectedResumeId || !targetPosition || optimizing}
                className="h-9 md:h-10 bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {optimizing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('optimize.optimizing')}
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    {t('optimize.startOptimize')}
                  </>
                )}
              </Button>
              {jdContent && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setJdContent('');
                    setJdResults([]);
                    setSuggestions('');
                  }}
                  className="h-9 md:h-10 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  {t('optimize.clearJd')}
                </Button>
              )}
            </div>

            {/* 手动输入JD */}
            <div className="mt-3 md:mt-4">
              <div className="flex items-center justify-between mb-1.5 md:mb-2">
                <label className="text-xs md:text-sm font-medium">{t('optimize.jdLabel')}</label>
                <span className="text-[10px] md:text-xs text-zinc-400 dark:text-zinc-500">{t('optimize.jdHint')}</span>
              </div>
              <textarea
                placeholder={t('optimize.jdPlaceholder')}
                value={jdContent}
                onChange={(e) => setJdContent(e.target.value)}
                className="w-full min-h-[100px] md:min-h-[120px] p-3 text-xs md:text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 resize-y focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-600 placeholder:text-zinc-400/70"
              />
            </div>

            {/* JD搜索结果 */}
            {jdContent && (
              <div className="mt-3 md:mt-4 p-3 md:p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-6 h-6 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center">
                    <Target className="h-3.5 w-3.5 text-white dark:text-zinc-900" />
                  </span>
                  <span className="text-xs md:text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {t('optimize.jdSet')}
                  </span>
                </div>
                <p className="text-xs md:text-sm text-zinc-500 dark:text-zinc-400 mb-2">
                  {t('optimize.jdSetDesc')}
                </p>
                <div className="max-h-32 md:max-h-40 overflow-y-auto">
                  <p className="text-xs md:text-sm text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">
                    {jdContent}
                  </p>
                </div>
              </div>
            )}

            {/* AI匹配优化建议 */}
            {suggestions && (
              <div className="mt-3 md:mt-4 p-3 md:p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800">
                <div className="flex items-start gap-2 md:gap-3">
                  <span className="w-6 h-6 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center mt-0.5 flex-shrink-0">
                    <Sparkles className="h-3.5 w-3.5 text-white dark:text-zinc-900" />
                  </span>
                  <div className="flex-1">
                    <h4 className="font-medium text-zinc-900 dark:text-zinc-100 mb-1.5 md:mb-2 text-sm md:text-base tracking-tight">
                      {t('optimize.suggestionsTitle')}
                    </h4>
                    <p className="text-xs md:text-sm text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">
                      {suggestions}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {optimizing && (
              <div className="mt-3 md:mt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs md:text-sm text-zinc-400 dark:text-zinc-500">{t('optimize.optimizingProgress')}</span>
                  <span className="text-xs md:text-sm font-medium">{optimizeProgress}%</span>
                </div>
                <Progress value={optimizeProgress} className="h-1.5 md:h-2" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Features */}
        <div className="relative grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-6 md:mb-8">
          <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none hover:shadow-lg hover:shadow-zinc-900/[0.05] dark:hover:shadow-black/30 transition-shadow">
            <CardContent className="pt-4 md:pt-6">
              <div className="w-10 h-10 rounded-xl bg-zinc-900 dark:bg-white flex items-center justify-center mb-3 md:mb-4">
                <CheckCircle className="h-5 w-5 text-white dark:text-zinc-900" />
              </div>
              <h3 className="font-semibold tracking-tight mb-1.5 md:mb-2 text-sm md:text-base text-zinc-900 dark:text-zinc-50">{t('optimize.feature1Title')}</h3>
              <p className="text-xs md:text-sm text-zinc-500 dark:text-zinc-400">
                {t('optimize.feature1Desc')}
              </p>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none hover:shadow-lg hover:shadow-zinc-900/[0.05] dark:hover:shadow-black/30 transition-shadow">
            <CardContent className="pt-4 md:pt-6">
              <div className="w-10 h-10 rounded-xl bg-zinc-900 dark:bg-white flex items-center justify-center mb-3 md:mb-4">
                <Target className="h-5 w-5 text-white dark:text-zinc-900" />
              </div>
              <h3 className="font-semibold tracking-tight mb-1.5 md:mb-2 text-sm md:text-base text-zinc-900 dark:text-zinc-50">{t('optimize.feature2Title')}</h3>
              <p className="text-xs md:text-sm text-zinc-500 dark:text-zinc-400">
                {t('optimize.feature2Desc')}
              </p>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-zinc-200 dark:border-zinc-800 shadow-none hover:shadow-lg hover:shadow-zinc-900/[0.05] dark:hover:shadow-black/30 transition-shadow">
            <CardContent className="pt-4 md:pt-6">
              <div className="w-10 h-10 rounded-xl bg-zinc-900 dark:bg-white flex items-center justify-center mb-3 md:mb-4">
                <Sparkles className="h-5 w-5 text-white dark:text-zinc-900" />
              </div>
              <h3 className="font-semibold tracking-tight mb-1.5 md:mb-2 text-sm md:text-base text-zinc-900 dark:text-zinc-50">{t('optimize.feature3Title')}</h3>
              <p className="text-xs md:text-sm text-zinc-500 dark:text-zinc-400">
                {t('optimize.feature3Desc')}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Tips */}
        <Card className="relative rounded-2xl border-dashed border-zinc-200 dark:border-zinc-800 shadow-none bg-zinc-50/60 dark:bg-zinc-900/30">
          <CardContent className="pt-4 md:pt-6">
            <div className="flex items-start gap-2 md:gap-3">
              <AlertCircle className="h-4 w-4 md:h-5 md:w-5 text-zinc-400 dark:text-zinc-500 mt-0.5" />
              <div>
                <h4 className="font-medium tracking-tight mb-1.5 md:mb-2 text-sm md:text-base text-zinc-900 dark:text-zinc-100">{t('optimize.tipsTitle')}</h4>
                <ul className="text-xs md:text-sm text-zinc-500 dark:text-zinc-400 space-y-0.5 md:space-y-1">
                  <li>• {t('optimize.tip1')}</li>
                  <li>• {t('optimize.tip2')}</li>
                  <li>• {t('optimize.tip3')}</li>
                  <li>• {t('optimize.tip4')}</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Result Dialog */}
      <Dialog open={showResult} onOpenChange={setShowResult}>
        <DialogContent className="!max-w-none w-[95vw] md:w-[90vw] max-h-[90vh] md:h-[85vh] overflow-hidden flex flex-col p-3 md:p-4">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2.5 text-base md:text-lg tracking-tight text-zinc-900 dark:text-zinc-50">
              <span className="w-7 h-7 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center">
                <CheckCircle className="h-4 w-4 text-white dark:text-zinc-900" />
              </span>
              {t('optimize.resultTitle')}
            </DialogTitle>
            <DialogDescription className="text-xs md:text-sm text-zinc-500 dark:text-zinc-400">
              {t('optimize.resultDesc')}
            </DialogDescription>
          </DialogHeader>

          {/* 操作按钮 */}
          <div className="flex flex-wrap justify-end gap-2 mb-2 flex-shrink-0">
            <Button
              variant={isEditing ? "default" : "outline"}
              size="sm"
              onClick={() => {
                if (isEditing) {
                  // 保存编辑内容
                  setOptimizedContent(editedContent);
                } else {
                  // 进入编辑模式 - 使用可读文本格式
                  const readableText = resumeData
                    ? resumeDataToText(resumeData, isEnglishVersion)
                    : optimizedContent;
                  setEditedContent(readableText);
                }
                setIsEditing(!isEditing);
              }}
              className={`h-9 text-xs items-center ${isEditing ? 'bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200' : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'}`}
            >
              {isEditing ? (
                <>
                  <Eye className="mr-1.5 h-3.5 w-3.5" />
                  {t('optimize.preview')}
                </>
              ) : (
                <>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  {t('optimize.edit')}
                </>
              )}
            </Button>
            <Button variant="outline" size="sm" onClick={handleCopy} className="h-9 text-xs items-center border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              {t('optimize.copy')}
            </Button>
            {resumeData && (
              <Button variant="outline" size="sm" onClick={handleSave} className="h-9 text-xs items-center relative border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {t('optimize.save')}
                {showSavedToast && (
                  <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-zinc-900 dark:bg-white dark:text-zinc-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                    {t('optimize.saved')}
                  </span>
                )}
              </Button>
            )}
            {resumeData && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={translating} className="h-9 text-xs items-center border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                    {translating ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        {t('optimize.translating')}
                      </>
                    ) : (
                      <>
                        <Languages className="mr-1.5 h-3.5 w-3.5" />
                        {t('optimize.translate')}
                      </>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem 
                    onClick={() => handleTranslate('chinese')}
                    disabled={!isEnglishVersion}
                    className={!isEnglishVersion ? 'opacity-50 cursor-not-allowed' : ''}
                  >
                    {t('optimize.toChinese')}
                    {!isEnglishVersion && <Badge variant="secondary" className="ml-2 text-[10px]">{t('optimize.current')}</Badge>}
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => handleTranslate('english')}
                    disabled={isEnglishVersion}
                    className={isEnglishVersion ? 'opacity-50 cursor-not-allowed' : ''}
                  >
                    {t('optimize.toEnglish')}
                    {isEnglishVersion && <Badge variant="secondary" className="ml-2 text-[10px]">{t('optimize.current')}</Badge>}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button size="sm" className="h-9 text-xs items-center bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200" onClick={handleDownload} disabled={downloading}>
              {downloading ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  {t('optimize.generating')}
                </>
              ) : (
                <>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  {t('optimize.download')}
                </>
              )}
            </Button>
          </div>
          
          {/* 对比视图 - 手机端上下布局，桌面端左右布局 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 flex-1 min-h-0 overflow-hidden">
            {/* 原简历 */}
            <div className="flex flex-col min-h-0 overflow-hidden">
              <div className="flex items-center gap-1.5 md:gap-2 mb-1.5 md:mb-2 flex-shrink-0">
                <FileText className="h-3.5 w-3.5 md:h-4 md:w-4 text-zinc-400" />
                <h3 className="font-medium text-zinc-500 dark:text-zinc-400 text-xs md:text-sm">{t('optimize.originalResume')}</h3>
              </div>
              <div className="bg-zinc-100 dark:bg-zinc-800/60 p-2 md:p-3 rounded-lg flex-1 overflow-y-auto min-h-[150px] md:min-h-0">
                <div className="bg-white p-3 md:p-6 shadow rounded-lg text-xs md:text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                  {originalContent}
                </div>
              </div>
            </div>

            {/* 优化后简历 */}
            <div className="flex flex-col min-h-0 overflow-hidden">
              <div className="flex items-center gap-1.5 md:gap-2 mb-1.5 md:mb-2 flex-shrink-0">
                <Sparkles className="h-3.5 w-3.5 md:h-4 md:w-4 text-zinc-900 dark:text-zinc-100" />
                <h3 className="font-medium text-zinc-900 dark:text-zinc-100 text-xs md:text-sm">{t('optimize.optimizedResume')}</h3>
                <Badge variant="secondary" className="ml-0.5 text-[10px] md:text-xs h-4 md:h-5 bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:bg-zinc-900">{t('optimize.atsBadge')}</Badge>
              </div>
              <div className="bg-zinc-100 dark:bg-zinc-800/60 p-2 md:p-3 rounded-lg flex-1 overflow-y-auto min-h-[200px] md:min-h-0">
                {isEditing ? (
                  <textarea
                    className="w-full h-full min-h-[300px] bg-white p-3 md:p-6 rounded-lg text-xs md:text-sm text-gray-700 leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-600"
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                  />
                ) : resumeData ? (
                  <div className="md:scale-100 w-full">
                    <ResumePreview data={resumeData} isEnglish={isEnglishVersion} />
                  </div>
                ) : (
                  <div className="bg-white p-3 md:p-6 shadow rounded-lg text-xs md:text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
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
