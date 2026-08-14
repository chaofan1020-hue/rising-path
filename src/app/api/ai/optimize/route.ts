import { NextRequest, NextResponse } from 'next/server';
import { buildRegionBlock, resolveRegionKey } from '@/lib/region-dna';
import type { UserSegmentation } from '@/lib/user-segmentation';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { createTextProviderClient } from '@/lib/ai/text-provider';
import { requireConfirmedResume } from '@/lib/resume-access';
import {
  OPTIMIZED_RESUME_RESPONSE_SCHEMA,
  optimizationChangeStateSchema,
  optimizedResumeSchema,
  parseOptimizedResume,
  type OptimizedResumeData,
} from '@/lib/optimized-resume-contract';

// 地区名称映射
const REGION_NAMES: Record<string, string> = {
  'us': '美国',
  'uk': '英国',
  'sg': '新加坡',
  'hk': '香港',
  'au': '澳大利亚',
  'ca': '加拿大',
  'eu': '欧洲',
  'cn': '中国内地',
  'jp': '日本',
};

function positiveInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildOriginalResumeData(resume: Record<string, unknown>): OptimizedResumeData {
  const info = (resume.user_info && typeof resume.user_info === 'object' ? resume.user_info : {}) as Record<string, unknown>;
  const profile = (resume.profile && typeof resume.profile === 'object' ? resume.profile : {}) as Record<string, unknown>;
  const experiences = [
    ...(Array.isArray(profile.workExperience) ? profile.workExperience : []),
    ...(Array.isArray(profile.internships) ? profile.internships : []),
  ] as Array<Record<string, unknown>>;
  const education = Array.isArray(profile.education) ? profile.education as Array<Record<string, unknown>> : [];
  const projects = Array.isArray(profile.projects) ? profile.projects as Array<Record<string, unknown>> : [];
  const skills = Array.isArray(profile.skills) ? profile.skills : Array.isArray(info.skills) ? info.skills : [];

  return {
    name: typeof info.name === 'string' ? info.name : '',
    contact: {
      email: typeof info.email === 'string' ? info.email : '',
      phone: typeof info.phone === 'string' ? info.phone : '',
      location: typeof info.region === 'string' ? info.region : '',
      linkedin: '',
    },
    summary: '',
    skills: skills.map((item) => String(item)),
    experience: experiences.map((item) => ({
      title: typeof item.role === 'string' ? item.role : '',
      company: typeof item.company === 'string' ? item.company : '',
      location: '',
      period: [item.startDate, item.endDate].filter(Boolean).map(String).join(' - '),
      highlights: Array.isArray(item.highlights) ? item.highlights.map(String) : [],
    })),
    education: education.map((item) => ({
      degree: typeof item.degree === 'string' ? item.degree : '',
      school: typeof item.school === 'string' ? item.school : '',
      major: typeof item.major === 'string' ? item.major : '',
      period: [item.startYear, item.endYear].filter(Boolean).map(String).join(' - '),
      gpa: typeof item.gpa === 'string' ? item.gpa : '',
    })),
    projects: projects.map((item) => ({
      name: typeof item.name === 'string' ? item.name : '',
      role: typeof item.role === 'string' ? item.role : '',
      period: '',
      description: Array.isArray(item.techStack) ? item.techStack.map(String).join(', ') : '',
      highlights: Array.isArray(item.outcomes) ? item.outcomes.map(String) : [],
    })),
    certifications: Array.isArray(profile.certificates) ? profile.certificates.map(String) : [],
    change_items: [],
  };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const body = await request.json();
    const resumeId = body?.resumeId;
    const jobId = body?.jobId === undefined || body?.jobId === null || body?.jobId === ''
      ? null
      : positiveInteger(body.jobId);
    if (body?.jobId !== undefined && body?.jobId !== null && body?.jobId !== '' && jobId === null) {
      return NextResponse.json({ error: '目标岗位 ID 无效' }, { status: 400 });
    }

    let targetCompany = textValue(body?.targetCompany);
    let targetPosition = textValue(body?.targetPosition);
    let targetRegion = textValue(body?.targetRegion);
    const suggestions = textValue(body?.suggestions);
    let jdContent = textValue(body?.jdContent);

    const resumeAccess = await requireConfirmedResume(client, resumeId, auth.user.id);
    if (!resumeAccess.ok) {
      return NextResponse.json({ error: resumeAccess.error }, { status: resumeAccess.status });
    }
    const resume = resumeAccess.resume;

    let targetJob: {
      id: number;
      title: string;
      company: string;
      region: string;
      description?: string;
      requirements?: string;
    } | null = null;
    if (jobId !== null) {
      const { data, error } = await client
        .from('jobs')
        .select('id, title, company, region, description, requirements')
        .eq('id', jobId)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw new Error(`查询目标岗位失败: ${error.message}`);
      if (!data) return NextResponse.json({ error: '目标岗位不存在或已下架' }, { status: 404 });
      targetJob = data;
      targetCompany ||= textValue(data.company);
      targetPosition ||= textValue(data.title);
      targetRegion ||= textValue(data.region);
      jdContent ||= [data.description, data.requirements].filter(Boolean).join('\n\n');
    }

    if (!targetPosition) {
      return NextResponse.json({ error: '目标岗位不能为空' }, { status: 400 });
    }

    // AI optimization
    const llmClient = createTextProviderClient({ requestHeaders: request.headers });
    
    const resumeContent = resume.parsed_content || JSON.stringify(resume.user_info);
    const originalData = buildOriginalResumeData(resume);

    // 构建地区信息：深度地区招聘逻辑（ATS 偏好/简历写法/关键信号），
    // 优先用户指定地区，其次用简历分层推导的地区（地区为分层第一权重）
    const seg = resume.segmentation as UserSegmentation | null;
    const regionKey = resolveRegionKey(targetRegion) || seg?.regions?.[0] || null;
    const regionSection = regionKey
      ? `\n\n${buildRegionBlock(regionKey, 'zh')}\n请严格遵循上述地区规则优化简历写法与内容取舍。`
      : (targetRegion ? `\n\n目标地区：${REGION_NAMES[targetRegion] || targetRegion}\n请考虑该地区的招聘习惯和用语习惯进行优化。` : '');

    // 候选人分层上下文（让 ATS 优化按层级差异化：低年级重课程项目，社招重业务 impact）
    const stageTips: Record<string, string> = {
      junior: '该候选人是低年级学生（实习预备）：突出课程项目、竞赛、技能成长潜力，弥补实习经历不足。',
      senior: '该候选人是应届校招：突出实习成果转化与岗位匹配度，实习描述必须有量化结果。',
      experienced: '该候选人是社招人士：突出业务 impact、ownership 与职级匹配度，弱化课程/社团等学生气内容。',
      returning_intern: '该候选人处于实习转正阶段：突出实习期间的独立交付与团队依赖度。',
    };
    const segmentSection = seg
      ? `\n\n【候选人分层】${seg.summary}${stageTips[seg.careerStage] ? `\n${stageTips[seg.careerStage]}` : ''}`
      : '';

    // 构建岗位描述部分（如果获取到了）
    const jdSection = jdContent
      ? `\n\n【目标岗位的真实描述和要求】\n${jdContent}\n\n请严格按照上述岗位描述中的要求来优化简历，确保简历内容与岗位需求高度匹配。`
      : '';

    // 构建优化建议部分
    const suggestionsSection = suggestions 
      ? `\n\n参考优化建议：\n${suggestions}\n\n请根据以上建议重点优化简历的相应部分。`
      : '';

    const prompt = `你是一个专业的简历优化专家，擅长针对ATS（Applicant Tracking System）系统优化简历。

请根据以下信息优化简历：

目标公司：${targetCompany || '通用'}
目标岗位：${targetPosition}${regionSection}${segmentSection}${jdSection}

原简历内容：
${resumeContent}${suggestionsSection}

重要：请保持与原简历相同的语言！如果原简历是中文，则优化后的简历全部使用中文；如果原简历是英文，则优化后的简历全部使用英文。

请优化简历并以JSON格式输出，格式如下：
{
  "name": "姓名",
  "contact": {
    "email": "邮箱",
    "phone": "电话",
    "location": "所在地",
    "linkedin": "LinkedIn链接（如有）"
  },
  "summary": "个人简介（2-3句话概述背景和优势）",
  "skills": ["技能1", "技能2", "技能3"],
  "experience": [
    {
      "title": "职位名称",
      "company": "公司名称",
      "location": "工作地点",
      "period": "时间段（如：2021.06 - 2023.08）",
      "highlights": ["成就1", "成就2", "成就3"]
    }
  ],
  "education": [
    {
      "degree": "学位",
      "school": "学校名称",
      "major": "专业",
      "period": "时间段",
      "gpa": "GPA（如有）"
    }
  ],
  "projects": [
    {
      "name": "项目名称",
      "role": "担任角色",
      "period": "时间段",
      "description": "项目描述",
      "highlights": ["成果1", "成果2"]
    }
  ],
  "certifications": ["证书1", "证书2"],
  "change_items": [
    {
      "id": "change-1",
      "section": "summary",
      "title": "个人简介更贴近岗位",
      "before": "原简历中的对应内容；没有内容时填写空字符串",
      "after": "修改后的完整内容",
      "rationale": "对应目标岗位的具体要求"
    }
  ]
}

优化要求：
1. 添加目标岗位相关的关键词和技能
2. 使用STAR法则量化工作成果
3. 突出与目标岗位最相关的经验
4. 保持内容真实，基于原简历优化
5. 保持与原简历相同的语言（中文或英文）
6. change_items 的 section 只能使用 summary、skills、experience、education、projects、certifications 或 contact；after 必须逐字对应上方结构化简历中新增或修改后的内容，before 必须逐字对应原简历内容，没有原内容时填写空字符串

只返回JSON，不要其他说明文字。`;

    const stream = llmClient.stream([
      { role: 'system', content: '你是一个专业的简历优化专家，擅长针对ATS系统优化简历，提高简历通过率。请始终以有效的JSON格式输出，并保持与原简历相同的语言。' },
      { role: 'user', content: prompt },
    ], {
      temperature: 0.7,
      responseFormat: {
        name: 'optimized_resume',
        schema: OPTIMIZED_RESUME_RESPONSE_SCHEMA,
      },
    });

    let optimizedContent = '';
    for await (const chunk of stream) {
      if (chunk.content) {
        optimizedContent += chunk.content.toString();
      }
    }

    let parsed: OptimizedResumeData;
    try {
      parsed = parseOptimizedResume(optimizedContent);
    } catch (error) {
      console.error('Invalid optimized resume response:', error);
      return NextResponse.json(
        { error: 'AI返回的简历优化结果格式无效，请重试' },
        { status: 502 },
      );
    }

    // 检测语言：检查内容中是否主要是英文字符
    const { change_items: generatedChangeItems, ...resumeData } = parsed;
    const changeItems = generatedChangeItems.map((item) => ({
      ...item,
      status: 'pending' as const,
    }));

    const textToCheck = `${resumeData.name} ${resumeData.summary} ${resumeData.skills.join(' ')}`;
    const englishCharCount = (textToCheck.match(/[a-zA-Z]/g) || []).length;
    const chineseCharCount = (textToCheck.match(/[\u4e00-\u9fa5]/g) || []).length;
    const isEnglish = englishCharCount > chineseCharCount;

    const { data: optimization, error: optimizationError } = await client
      .from('resume_optimizations')
      .insert({
        user_id: auth.user.id,
        resume_id: resume.id,
        job_id: targetJob?.id || null,
        resume_profile_version: Number(resume.profile_version),
        target_company: targetCompany,
        target_position: targetPosition,
        target_region: targetRegion || null,
        original_content: resumeContent,
        original_data: originalData,
        optimized_content: resumeData,
        reviewed_content: resumeData,
        change_items: changeItems,
        is_english: isEnglish,
      })
      .select('id, resume_id, job_id, resume_profile_version, target_company, target_position, target_region, is_english, created_at, updated_at')
      .single();
    if (optimizationError || !optimization) {
      throw new Error(`保存简历优化版本失败: ${optimizationError?.message || '未返回记录'}`);
    }

    return NextResponse.json({ 
      optimized_content: optimizedContent,
      resume_data: resumeData,
      change_items: changeItems,
      original_content: resumeContent,
      original_data: originalData,
      is_english: isEnglish,
      optimization_id: optimization.id,
      resume_profile_version: Number(resume.profile_version),
      job_id: targetJob?.id || null,
    });
  } catch (error) {
    console.error('Optimization error:', error);
    return NextResponse.json(
      { error: '简历优化失败' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();

    const resumeIdValue = request.nextUrl.searchParams.get('resumeId');
    const jobIdValue = request.nextUrl.searchParams.get('jobId');
    const resumeId = resumeIdValue ? positiveInteger(resumeIdValue) : null;
    const jobId = jobIdValue ? positiveInteger(jobIdValue) : null;
    if ((resumeIdValue && resumeId === null) || (jobIdValue && jobId === null)) {
      return NextResponse.json({ error: '简历 ID 或岗位 ID 无效' }, { status: 400 });
    }

    let query = auth.client
      .from('resume_optimizations')
      .select('id, resume_id, job_id, resume_profile_version, target_company, target_position, target_region, original_content, original_data, optimized_content, reviewed_content, edited_content, change_items, score_comparison, original_score, optimized_score, is_english, created_at, updated_at')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (resumeId !== null) query = query.eq('resume_id', resumeId);
    if (jobId !== null) query = query.eq('job_id', jobId);

    const { data, error } = await query;
    if (error) throw new Error(`读取简历优化历史失败: ${error.message}`);

    const resumeCache = new Map<number, Record<string, unknown>>();
    const optimizations = await Promise.all((data || []).map(async (item) => {
      const hasOriginalData = item.original_data
        && typeof item.original_data === 'object'
        && !Array.isArray(item.original_data)
        && Object.keys(item.original_data as Record<string, unknown>).length > 0;
      if (hasOriginalData || !item.resume_id) return item;

      let resume = resumeCache.get(item.resume_id);
      if (!resume) {
        const { data: resumeData, error: resumeError } = await auth.client
          .from('resumes')
          .select('*')
          .eq('id', item.resume_id)
          .eq('user_id', auth.user.id)
          .maybeSingle();
        if (!resumeError && resumeData) {
          resume = resumeData as Record<string, unknown>;
          resumeCache.set(item.resume_id, resume);
        }
      }

      return resume
        ? { ...item, original_data: buildOriginalResumeData(resume) }
        : item;
    }));

    return NextResponse.json({ optimizations });
  } catch (error) {
    console.error('Error fetching resume optimizations:', error);
    return NextResponse.json({ error: '读取简历优化历史失败' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();

    const body = await request.json();
    const optimizationId = positiveInteger(body?.optimizationId);
    const parsed = optimizedResumeSchema.omit({ change_items: true }).safeParse(body?.resumeData);
    const changeItems = body?.changeItems === undefined
      ? null
      : optimizationChangeStateSchema.array().max(12).safeParse(body.changeItems);
    if (optimizationId === null || !parsed.success || (changeItems && !changeItems.success)) {
      return NextResponse.json({ error: '优化版本或简历内容无效' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {
      reviewed_content: parsed.data,
      updated_at: new Date().toISOString(),
    };
    if (typeof body?.editedContent === 'string' || body?.editedContent === null) {
      updates.edited_content = body.editedContent;
    }
    if (changeItems?.success) updates.change_items = changeItems.data;
    if (typeof body?.isEnglish === 'boolean') updates.is_english = body.isEnglish;

    const { data, error } = await auth.client
      .from('resume_optimizations')
      .update(updates)
      .eq('id', optimizationId)
      .eq('user_id', auth.user.id)
      .select('id, resume_id, job_id, resume_profile_version, target_company, target_position, target_region, optimized_content, reviewed_content, is_english, created_at, updated_at')
      .single();
    if (error || !data) throw new Error(`更新简历优化版本失败: ${error?.message || '未找到记录'}`);

    return NextResponse.json({ optimization: data });
  } catch (error) {
    console.error('Error updating resume optimization:', error);
    return NextResponse.json({ error: '保存简历优化版本失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();

    const body = await request.json();
    const optimizationId = positiveInteger(body?.optimizationId);
    if (optimizationId === null) {
      return NextResponse.json({ error: '优化版本 ID 无效' }, { status: 400 });
    }

    const { error } = await auth.client
      .from('resume_optimizations')
      .delete()
      .eq('id', optimizationId)
      .eq('user_id', auth.user.id);
    if (error) throw new Error(`删除简历优化版本失败: ${error.message}`);

    return NextResponse.json({ success: true, optimization_id: optimizationId });
  } catch (error) {
    console.error('Error deleting resume optimization:', error);
    return NextResponse.json({ error: '删除简历优化版本失败' }, { status: 500 });
  }
}
