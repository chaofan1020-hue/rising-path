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
  Briefcase,
  Wand2,
  Target,
  AlertCircle,
  Languages,
  Save,
  Clock,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import { saveAs } from 'file-saver';
import { AccessGuard, useAccessCode } from '@/components/access-guard';

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

// 简历预览组件
const ResumePreview = ({ data }: { data: ResumeData }) => {
  return (
    <div className="bg-white text-black p-4 md:p-8 shadow-lg rounded-lg">
      {/* 头部：姓名和联系方式 */}
      <div className="text-center border-b-2 border-gray-800 pb-3 md:pb-4 mb-3 md:mb-4">
        <h1 className="text-lg md:text-2xl font-bold text-gray-900 mb-1 md:mb-2">{data.name || '姓名'}</h1>
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
            个人简介
          </h2>
          <p className="text-xs md:text-sm text-gray-700 leading-relaxed">{data.summary}</p>
        </div>
      )}

      {/* 技能 */}
      {data.skills && data.skills.length > 0 && (
        <div className="mb-3 md:mb-4">
          <h2 className="text-xs md:text-sm font-bold text-gray-800 uppercase tracking-wide border-b border-gray-300 pb-1 mb-1.5 md:mb-2">
            专业技能
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
            工作经历
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
            教育背景
          </h2>
          <div className="space-y-1.5 md:space-y-2">
            {data.education.map((edu, index) => (
              <div key={index} className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-0.5 sm:gap-0">
                <div className="text-xs md:text-sm">
                  <span className="font-semibold text-gray-900">{edu.degree}</span>
                  {edu.major && <span className="text-gray-600 mx-1">in {edu.major}</span>}
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
            项目经历
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
            证书资质
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
  const [showSavedToast, setShowSavedToast] = useState(false);
  const { accessCodeId } = useAccessCode();

  // 加载历史记录
  useEffect(() => {
    const saved = localStorage.getItem('optimized_records');
    if (saved) {
      try {
        setSavedRecords(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse saved records:', e);
      }
    }
  }, []);

  // 保存到本地存储
  const handleSave = () => {
    if (!resumeData || !selectedResumeId) return;
    
    const record: OptimizedRecord = {
      id: Date.now().toString(),
      resumeId: selectedResumeId,
      resumeName: resumes.find(r => r.id.toString() === selectedResumeId)?.file_name || '未知简历',
      targetCompany,
      targetPosition,
      resumeData,
      isEnglish: isEnglishVersion,
      createdAt: new Date().toISOString(),
    };
    
    const newRecords = [record, ...savedRecords].slice(0, 20); // 最多保存20条
    setSavedRecords(newRecords);
    localStorage.setItem('optimized_records', JSON.stringify(newRecords));
    setShowSavedToast(true);
    setTimeout(() => setShowSavedToast(false), 2000);
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
    localStorage.setItem('optimized_records', JSON.stringify(newRecords));
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
      setIsEnglishVersion(data.is_english || false);
      setShowResult(true);

      // 自动保存
      if (data.resume_data) {
        const record: OptimizedRecord = {
          id: Date.now().toString(),
          resumeId: selectedResumeId,
          resumeName: resumes.find(r => r.id.toString() === selectedResumeId)?.file_name || '未知简历',
          targetCompany,
          targetPosition,
          resumeData: data.resume_data,
          isEnglish: data.is_english || false,
          createdAt: new Date().toISOString(),
        };
        const newRecords = [record, ...savedRecords].slice(0, 20);
        setSavedRecords(newRecords);
        localStorage.setItem('optimized_records', JSON.stringify(newRecords));
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
      text += `${resumeData.name || '姓名'}\n`;
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
        text += `个人简介\n${resumeData.summary}\n\n`;
      }
      
      if (resumeData.skills && resumeData.skills.length > 0) {
        text += `专业技能\n${resumeData.skills.join('、')}\n\n`;
      }
      
      if (resumeData.experience && resumeData.experience.length > 0) {
        text += `工作经历\n`;
        resumeData.experience.forEach(exp => {
          text += `${exp.title} | ${exp.company}${exp.location ? ` · ${exp.location}` : ''} | ${exp.period}\n`;
          exp.highlights.forEach(h => text += `• ${h}\n`);
          text += '\n';
        });
      }
      
      if (resumeData.education && resumeData.education.length > 0) {
        text += `教育背景\n`;
        resumeData.education.forEach(edu => {
          text += `${edu.degree}${edu.major ? ` in ${edu.major}` : ''} | ${edu.school} | ${edu.period}`;
          if (edu.gpa) text += ` | GPA: ${edu.gpa}`;
          text += '\n';
        });
        text += '\n';
      }
      
      if (resumeData.projects && resumeData.projects.length > 0) {
        text += `项目经历\n`;
        resumeData.projects.forEach(proj => {
          text += `${proj.name}${proj.role ? ` | ${proj.role}` : ''}${proj.period ? ` | ${proj.period}` : ''}\n`;
          if (proj.description) text += `${proj.description}\n`;
          proj.highlights.forEach(h => text += `• ${h}\n`);
          text += '\n';
        });
      }
      
      if (resumeData.certifications && resumeData.certifications.length > 0) {
        text += `证书认证\n${resumeData.certifications.join('\n')}\n`;
      }
      
      navigator.clipboard.writeText(text.trim());
    } else {
      navigator.clipboard.writeText(optimizedContent);
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
              text: resumeData.name || '姓名',
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
            text: '个人简介',
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
            text: '专业技能',
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
            text: '工作经历',
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
            text: '教育背景',
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
            text: '项目经历',
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
            text: '证书认证',
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
      alert('生成Word文档失败，请重试');
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
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-1 md:mb-2 flex items-center gap-2 md:gap-3">
            <Wand2 className="h-6 w-6 md:h-8 md:w-8 text-orange-600" />
            ATS简历优化
          </h1>
          <p className="text-sm md:text-base text-muted-foreground">
            针对ATS系统优化简历，提高简历通过率和曝光率
          </p>
        </div>

        {/* 历史记录 */}
        {savedRecords.length > 0 && (
          <Card className="mb-6 md:mb-8">
            <CardHeader className="pb-2 md:pb-4">
              <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                <Clock className="h-4 w-4 md:h-5 md:w-5" />
                优化历史
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {savedRecords.slice(0, 5).map((record) => (
                  <div 
                    key={record.id}
                    className="flex items-center justify-between p-2 md:p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer group"
                    onClick={() => loadRecord(record)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs md:text-sm font-medium truncate">
                          {record.targetPosition}
                        </span>
                        {record.targetCompany && (
                          <Badge variant="secondary" className="text-[10px] md:text-xs">
                            {record.targetCompany}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] md:text-xs">
                          {record.isEnglish ? '英文' : '中文'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] md:text-xs text-muted-foreground truncate">
                          {record.resumeName}
                        </span>
                        <span className="text-[10px] md:text-xs text-muted-foreground">
                          {new Date(record.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
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
        <Card className="mb-6 md:mb-8">
          <CardHeader className="pb-2 md:pb-4">
            <CardTitle className="flex items-center gap-2 text-base md:text-lg">
              <Target className="h-4 w-4 md:h-5 md:w-5" />
              优化设置
            </CardTitle>
            <CardDescription className="text-xs md:text-sm">
              选择简历并设置目标岗位，AI将针对性优化简历内容
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 md:space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
              <div>
                <label className="text-xs md:text-sm font-medium mb-1.5 md:mb-2 block">选择简历</label>
                <Select value={selectedResumeId} onValueChange={setSelectedResumeId}>
                  <SelectTrigger className="h-9 md:h-10">
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
                <label className="text-xs md:text-sm font-medium mb-1.5 md:mb-2 block">目标公司（可选）</label>
                <Input
                  placeholder="如：Google, Apple..."
                  value={targetCompany}
                  onChange={(e) => setTargetCompany(e.target.value)}
                  className="h-9 md:h-10"
                />
              </div>
              <div>
                <label className="text-xs md:text-sm font-medium mb-1.5 md:mb-2 block">目标岗位</label>
                <Input
                  placeholder="如：软件工程师..."
                  value={targetPosition}
                  onChange={(e) => setTargetPosition(e.target.value)}
                  className="h-9 md:h-10"
                />
              </div>
            </div>

            <div className="flex gap-3 md:gap-4">
              <Button 
                onClick={handleOptimize}
                disabled={!selectedResumeId || !targetPosition || optimizing}
                className="bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 h-9 md:h-10"
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
              <div className="mt-3 md:mt-4 p-3 md:p-4 rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800">
                <div className="flex items-start gap-2 md:gap-3">
                  <Sparkles className="h-4 w-4 md:h-5 md:w-5 text-purple-600 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <h4 className="font-medium text-purple-700 dark:text-purple-300 mb-1.5 md:mb-2 text-sm md:text-base">
                      来自AI智能选岗的优化建议
                    </h4>
                    <p className="text-xs md:text-sm text-purple-600 dark:text-purple-400 whitespace-pre-wrap">
                      {suggestions}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {optimizing && (
              <div className="mt-3 md:mt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs md:text-sm text-muted-foreground">AI正在优化简历...</span>
                  <span className="text-xs md:text-sm font-medium">{optimizeProgress}%</span>
                </div>
                <Progress value={optimizeProgress} className="h-1.5 md:h-2" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-6 md:mb-8">
          <Card>
            <CardContent className="pt-4 md:pt-6">
              <CheckCircle className="h-8 w-8 md:h-10 md:w-10 text-green-600 mb-3 md:mb-4" />
              <h3 className="font-semibold mb-1.5 md:mb-2 text-sm md:text-base">关键词优化</h3>
              <p className="text-xs md:text-sm text-muted-foreground">
                自动分析岗位要求，添加关键技能词汇
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 md:pt-6">
              <Target className="h-8 w-8 md:h-10 md:w-10 text-blue-600 mb-3 md:mb-4" />
              <h3 className="font-semibold mb-1.5 md:mb-2 text-sm md:text-base">ATS友好格式</h3>
              <p className="text-xs md:text-sm text-muted-foreground">
                优化简历格式，确保ATS系统正确解析
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 md:pt-6">
              <Sparkles className="h-8 w-8 md:h-10 md:w-10 text-purple-600 mb-3 md:mb-4" />
              <h3 className="font-semibold mb-1.5 md:mb-2 text-sm md:text-base">内容增强</h3>
              <p className="text-xs md:text-sm text-muted-foreground">
                使用专业术语增强简历描述
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Tips */}
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="pt-4 md:pt-6">
            <div className="flex items-start gap-2 md:gap-3">
              <AlertCircle className="h-4 w-4 md:h-5 md:w-5 text-amber-600 mt-0.5" />
              <div>
                <h4 className="font-medium mb-1.5 md:mb-2 text-sm md:text-base">ATS优化建议</h4>
                <ul className="text-xs md:text-sm text-muted-foreground space-y-0.5 md:space-y-1">
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
        <DialogContent className="!max-w-none w-[95vw] md:w-[90vw] max-h-[90vh] md:h-[85vh] overflow-hidden flex flex-col p-3 md:p-4">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base md:text-lg">
              <CheckCircle className="h-4 w-4 md:h-5 md:w-5 text-green-600" />
              简历优化完成
            </DialogTitle>
            <DialogDescription className="text-xs md:text-sm">
              AI已根据目标岗位优化了您的简历内容
            </DialogDescription>
          </DialogHeader>
          
          {/* 操作按钮 */}
          <div className="flex flex-wrap justify-end gap-2 mb-2 flex-shrink-0">
            <Button variant="outline" size="sm" onClick={handleCopy} className="h-9 text-xs items-center">
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              复制
            </Button>
            {resumeData && (
              <Button variant="outline" size="sm" onClick={handleSave} className="h-9 text-xs items-center relative">
                <Save className="mr-1.5 h-3.5 w-3.5" />
                保存
                {showSavedToast && (
                  <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-green-600 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                    已保存
                  </span>
                )}
              </Button>
            )}
            {resumeData && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={translating} className="h-9 text-xs items-center">
                    {translating ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        转换中...
                      </>
                    ) : (
                      <>
                        <Languages className="mr-1.5 h-3.5 w-3.5" />
                        中英文转换
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
                    转为中文
                    {!isEnglishVersion && <Badge variant="secondary" className="ml-2 text-[10px]">当前</Badge>}
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => handleTranslate('english')}
                    disabled={isEnglishVersion}
                    className={isEnglishVersion ? 'opacity-50 cursor-not-allowed' : ''}
                  >
                    转为英文
                    {isEnglishVersion && <Badge variant="secondary" className="ml-2 text-[10px]">当前</Badge>}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button size="sm" className="h-9 text-xs items-center" onClick={handleDownload} disabled={downloading}>
              {downloading ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  下载简历
                </>
              )}
            </Button>
          </div>
          
          {/* 对比视图 - 手机端上下布局，桌面端左右布局 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 flex-1 min-h-0 overflow-hidden">
            {/* 原简历 */}
            <div className="flex flex-col min-h-0 overflow-hidden">
              <div className="flex items-center gap-1.5 md:gap-2 mb-1.5 md:mb-2 flex-shrink-0">
                <FileText className="h-3.5 w-3.5 md:h-4 md:w-4 text-gray-500" />
                <h3 className="font-medium text-gray-600 text-xs md:text-sm">原简历</h3>
              </div>
              <div className="bg-gray-100 p-2 md:p-3 rounded-lg flex-1 overflow-y-auto min-h-[150px] md:min-h-0">
                <div className="bg-white p-3 md:p-6 shadow rounded-lg text-xs md:text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                  {originalContent}
                </div>
              </div>
            </div>
            
            {/* 优化后简历 */}
            <div className="flex flex-col min-h-0 overflow-hidden">
              <div className="flex items-center gap-1.5 md:gap-2 mb-1.5 md:mb-2 flex-shrink-0">
                <Sparkles className="h-3.5 w-3.5 md:h-4 md:w-4 text-green-600" />
                <h3 className="font-medium text-green-600 text-xs md:text-sm">优化后简历</h3>
                <Badge variant="secondary" className="ml-0.5 text-[10px] md:text-xs h-4 md:h-5">ATS优化</Badge>
              </div>
              <div className="bg-gray-100 p-2 md:p-3 rounded-lg flex-1 overflow-y-auto min-h-[200px] md:min-h-0">
                {resumeData ? (
                  <div className="md:scale-100 w-full">
                    <ResumePreview data={resumeData} />
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
