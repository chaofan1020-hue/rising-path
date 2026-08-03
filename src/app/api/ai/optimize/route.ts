import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { buildRegionBlock, resolveRegionKey } from '@/lib/region-dna';
import type { UserSegmentation } from '@/lib/user-segmentation';

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

export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { resumeId, targetCompany, targetPosition, targetRegion, suggestions, accessCodeId, jdContent } = await request.json();

    // 必须提供 access_code_id
    if (!accessCodeId) {
      return NextResponse.json({ error: '未授权的访问' }, { status: 401 });
    }

    // Get resume and verify ownership
    const { data: resume, error } = await client
      .from('resumes')
      .select('*')
      .eq('id', resumeId)
      .eq('access_code_id', accessCodeId)
      .single();

    if (error || !resume) {
      return NextResponse.json({ error: '简历不存在或无权访问' }, { status: 404 });
    }

    // AI optimization
    const llmClient = new LLMClient(new Config(), HeaderUtils.extractForwardHeaders(request.headers));
    
    const resumeContent = resume.parsed_content || JSON.stringify(resume.user_info);

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
  "certifications": ["证书1", "证书2"]
}

优化要求：
1. 添加目标岗位相关的关键词和技能
2. 使用STAR法则量化工作成果
3. 突出与目标岗位最相关的经验
4. 保持内容真实，基于原简历优化
5. 保持与原简历相同的语言（中文或英文）

只返回JSON，不要其他说明文字。`;

    const stream = llmClient.stream([
      { role: 'system', content: '你是一个专业的简历优化专家，擅长针对ATS系统优化简历，提高简历通过率。请始终以有效的JSON格式输出，并保持与原简历相同的语言。' },
      { role: 'user', content: prompt },
    ], { temperature: 0.7 });

    let optimizedContent = '';
    for await (const chunk of stream) {
      if (chunk.content) {
        optimizedContent += chunk.content.toString();
      }
    }

    // 尝试解析JSON，验证格式正确
    try {
      const jsonMatch = optimizedContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // 检测语言：检查内容中是否主要是英文字符
        const textToCheck = `${parsed.name || ''} ${parsed.summary || ''} ${(parsed.skills || []).join(' ')}`;
        const englishCharCount = (textToCheck.match(/[a-zA-Z]/g) || []).length;
        const chineseCharCount = (textToCheck.match(/[\u4e00-\u9fa5]/g) || []).length;
        const isEnglish = englishCharCount > chineseCharCount;
        
        return NextResponse.json({ 
          optimized_content: optimizedContent,
          resume_data: parsed,
          original_content: resumeContent,
          is_english: isEnglish
        });
      }
    } catch (e) {
      console.error('Failed to parse optimized resume as JSON:', e);
    }

    // 如果JSON解析失败，返回原始内容
    return NextResponse.json({ 
      optimized_content: optimizedContent,
      original_content: resumeContent 
    });
  } catch (error) {
    console.error('Optimization error:', error);
    return NextResponse.json(
      { error: '简历优化失败' },
      { status: 500 }
    );
  }
}
