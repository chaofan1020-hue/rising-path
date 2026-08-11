import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { createTextProviderClient } from '@/lib/ai/text-provider';
import { extractFirstJsonObject } from '@/lib/json-extract';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const { resumeId, content, userInfo } = await request.json();

    if (!resumeId || !content) {
      return NextResponse.json({ error: '简历ID和内容不能为空' }, { status: 400 });
    }

    // 检测当前语言（简单判断：中文字符占比）
    const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
    const isChinese = chineseChars > content.length * 0.1;
    const targetLanguage = isChinese ? 'english' : 'chinese';

    const llmClient = createTextProviderClient({ requestHeaders: request.headers });

    const prompt = `请将以下简历内容翻译成${targetLanguage === 'english' ? '英文' : '中文'}。

原简历内容：
${content}

用户信息（JSON格式）：
${JSON.stringify(userInfo, null, 2)}

要求：
1. 翻译所有文本内容为${targetLanguage === 'english' ? '英文' : '中文'}
2. 专业术语可保留原语言（如技术名词Python、React等）
3. 公司名称、学校名称如果是知名机构，使用官方翻译或保持原语言
4. 返回JSON格式，包含 translated_content 和 user_info 两个字段
5. user_info 结构保持不变，只翻译其中的文本值

返回格式：
{
  "translated_content": "翻译后的完整简历内容",
  "user_info": {
    "name": "翻译后的姓名",
    "email": "邮箱（不变）",
    "phone": "电话（不变）",
    "education": ["翻译后的教育经历"],
    "experience": ["翻译后的工作经历"],
    "skills": ["翻译后的技能"]
  }
}

只返回JSON，不要其他说明文字。`;

    const stream = llmClient.stream([
      { 
        role: 'system', 
        content: `你是一个专业的简历翻译专家，擅长在中文和英文之间翻译简历内容。请始终以有效的JSON格式输出。` 
      },
      { role: 'user', content: prompt },
    ], { temperature: 0.3 });

    let result = '';
    for await (const chunk of stream) {
      if (chunk.content) {
        result += chunk.content.toString();
      }
    }

    // 解析JSON
    let translatedContent = content;
    let translatedUserInfo = userInfo;
    
    try {
      const parsed = extractFirstJsonObject(result);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('translation JSON object missing');
      const translatedData = parsed as { translated_content?: unknown; user_info?: unknown };
      if (typeof translatedData.translated_content !== 'string' || !translatedData.translated_content.trim()) {
        throw new Error('translated_content missing');
      }
      translatedContent = translatedData.translated_content;
      translatedUserInfo = translatedData.user_info ?? userInfo;
    } catch (e) {
      console.error('Failed to parse translation result:', e);
      return NextResponse.json({ error: '翻译结果格式无效，请重试' }, { status: 502 });
    }

    // 更新数据库
    const { error } = await client
      .from('resumes')
      .update({
        parsed_content: translatedContent,
        user_info: translatedUserInfo,
      })
      .eq('id', resumeId)
      .eq('user_id', auth.user.id);

    if (error) {
      console.error('Failed to update resume:', error);
      return NextResponse.json({ error: '翻译结果保存失败，请重试' }, { status: 500 });
    }

    return NextResponse.json({ 
      resume: {
        parsed_content: translatedContent,
        user_info: translatedUserInfo,
      }
    });
  } catch (error) {
    console.error('Translation error:', error);
    return NextResponse.json(
      { error: '翻译失败' },
      { status: 500 }
    );
  }
}
