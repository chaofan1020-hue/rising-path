import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { createTextProviderClient } from '@/lib/ai/text-provider';
import { consumeTrackedTextStream } from '@/lib/ai-usage';
import { betaEntitlementResponse } from '@/lib/beta-entitlements';
import { extractFirstJsonObject } from '@/lib/json-extract';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const { resumeData, targetLanguage } = await request.json();

    if (!resumeData) {
      return NextResponse.json({ error: '简历数据不能为空' }, { status: 400 });
    }

    const llmClient = createTextProviderClient({ requestHeaders: request.headers });

    const prompt = `请将以下简历数据翻译成${targetLanguage === 'english' ? '英文' : '中文'}。

简历数据（JSON格式）：
${JSON.stringify(resumeData, null, 2)}

要求：
1. 保持JSON结构完全不变
2. 将所有内容翻译成${targetLanguage === 'english' ? '英文' : '中文'}
3. 专业术语保持准确（如技术名词可保留英文原文）
4. 公司名称、学校名称如果是知名机构，保持原语言或使用官方英文名
5. 只返回翻译后的JSON，不要其他说明文字

请返回翻译后的JSON数据。`;

    const generated = await consumeTrackedTextStream(llmClient, [
      { 
        role: 'system', 
        content: `你是一个专业的简历翻译专家，擅长在中文和英文之间翻译简历内容。请始终以有效的JSON格式输出。` 
      },
      { role: 'user', content: prompt },
    ], { temperature: 0.3 }, {
      userId: auth.user.id,
      feature: 'resume_translate',
      metadata: { target_language: targetLanguage === 'english' ? 'en' : 'zh' },
    }, () => undefined);
    const result = generated.content;

    // 解析JSON
    try {
      const translatedData = extractFirstJsonObject(result);
      if (translatedData && typeof translatedData === 'object' && !Array.isArray(translatedData)) {
        return NextResponse.json({ resume_data: translatedData });
      }
    } catch (e) {
      console.error('Failed to parse translation result:', e);
    }

    return NextResponse.json({ error: '翻译失败，请重试' }, { status: 500 });
  } catch (error) {
    console.error('Translation error:', error);
    const betaResponse = betaEntitlementResponse(error);
    if (betaResponse) return betaResponse;
    return NextResponse.json(
      { error: '翻译失败' },
      { status: 500 }
    );
  }
}
