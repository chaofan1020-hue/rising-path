import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';

export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { resumeId, targetCompany, targetPosition, suggestions, accessCodeId } = await request.json();

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

    // 构建优化建议部分
    const suggestionsSection = suggestions 
      ? `\n\n参考优化建议：\n${suggestions}\n\n请根据以上建议重点优化简历的相应部分。`
      : '';

    const prompt = `你是一个专业的简历优化专家，擅长针对ATS（Applicant Tracking System）系统优化简历。

请根据以下信息优化简历：

目标公司：${targetCompany || '通用'}
目标岗位：${targetPosition}

原简历内容：
${resumeContent}${suggestionsSection}

请从以下方面优化简历：
1. 添加目标岗位相关的关键词和技能标签
2. 使用更专业、更有影响力的描述语言
3. 量化工作成果（如将"提升了性能"改为"性能提升50%"）
4. 调整格式使其更易于ATS系统解析
5. 突出与目标岗位最相关的经验

请直接输出优化后的简历内容，保持专业简洁。`;

    const stream = llmClient.stream([
      { role: 'system', content: '你是一个专业的简历优化专家，擅长针对ATS系统优化简历，提高简历通过率。' },
      { role: 'user', content: prompt },
    ], { temperature: 0.7 });

    let optimizedContent = '';
    for await (const chunk of stream) {
      if (chunk.content) {
        optimizedContent += chunk.content.toString();
      }
    }

    return NextResponse.json({ optimized_content: optimizedContent });
  } catch (error) {
    console.error('Optimization error:', error);
    return NextResponse.json(
      { error: '简历优化失败' },
      { status: 500 }
    );
  }
}
