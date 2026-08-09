import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { LLMClient, Config } from 'coze-coding-dev-sdk';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const body = await request.json();
    const { resume_id } = body;

    if (!resume_id) {
      return NextResponse.json({ error: '缺少简历ID' }, { status: 400 });
    }

    // 获取简历内容
    const { data: resume, error: resumeError } = await client
      .from('resumes')
      .select('parsed_content')
      .eq('id', resume_id)
      .eq('user_id', auth.user.id)
      .single();

    if (resumeError || !resume) {
      return NextResponse.json({ error: '简历不存在' }, { status: 404 });
    }

    if (!resume.parsed_content) {
      return NextResponse.json({ error: '简历未解析，请先上传并解析简历' }, { status: 400 });
    }

    // 使用 LLM 提取结构化字段
    const llmConfig = new Config();
    const llmClient = new LLMClient(llmConfig);

    const prompt = `请从以下简历文本中提取关键信息，并按 JSON 格式返回。返回格式：
{
  "name": "姓名",
  "email": "邮箱",
  "phone": "电话",
  "location": "地址/城市",
  "education": [
    {
      "school": "学校名称",
      "degree": "学位",
      "major": "专业",
      "duration": "时间范围",
      "gpa": "GPA（如有）"
    }
  ],
  "experience": [
    {
      "company": "公司名称",
      "title": "职位",
      "duration": "时间范围",
      "highlights": ["工作亮点1", "工作亮点2"]
    }
  ],
  "skills": {
    "technical": ["技能1", "技能2"],
    "languages": ["语言1"],
    "tools": ["工具1"]
  },
  "summary": "一句话自我介绍"
}

简历文本：
${resume.parsed_content.slice(0, 8000)}

请直接返回 JSON，不要有其他内容。`;

    const response = await llmClient.invoke(
      [{ role: 'user', content: prompt }],
      { 
        model: 'doubao-seed-1-6-lite-251015',
        temperature: 0.3 
      }
    );

    // 解析 LLM 返回的 JSON
    let parsedFields = null;
    const content = response.content.trim();
    
    // 尝试提取 JSON（处理可能的 markdown 代码块）
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }
    
    try {
      parsedFields = JSON.parse(jsonStr);
    } catch {
      // 如果解析失败，返回原始文本
      parsedFields = { raw: content, error: 'JSON解析失败' };
    }

    // 更新简历表
    const { error: updateError } = await client
      .from('resumes')
      .update({ parsed_fields: parsedFields })
      .eq('id', resume_id)
      .eq('user_id', auth.user.id);

    if (updateError) {
      console.error('Failed to update parsed_fields:', updateError);
    }

    return NextResponse.json({ 
      success: true, 
      parsed_fields: parsedFields 
    });

  } catch (error) {
    console.error('Error extracting resume fields:', error);
    return NextResponse.json(
      { error: '提取简历字段失败' },
      { status: 500 }
    );
  }
}
