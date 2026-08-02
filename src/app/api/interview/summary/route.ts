import { NextRequest } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';

interface ChatMessage {
  role: 'interviewer' | 'candidate';
  content: string;
}

export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const { accessCodeId, sessionId, language = 'zh' } = await request.json();

    if (!accessCodeId || !sessionId) {
      return new Response(JSON.stringify({ error: '缺少必要参数' }), { status: 400 });
    }

    const { data: session, error: sessionError } = await client
      .from('interview_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('access_code_id', accessCodeId)
      .single();

    if (sessionError || !session) {
      return new Response(JSON.stringify({ error: '面试会话不存在' }), { status: 404 });
    }

    const messages = (session.messages as ChatMessage[]) || [];
    if (messages.length < 2) {
      return new Response(JSON.stringify({ error: '面试内容太少，无法生成报告' }), { status: 400 });
    }

    const transcript = messages
      .map((m) => `${m.role === 'interviewer' ? (language === 'en' ? 'Interviewer' : '面试官') : (language === 'en' ? 'Candidate' : '候选人')}: ${m.content}`)
      .join('\n\n');

    const systemPrompt = language === 'en'
      ? 'You are a senior interview coach. Analyze mock interview transcripts and provide structured, actionable feedback reports in English.'
      : '你是一位资深面试教练，擅长分析模拟面试记录并给出结构化、可落地的中文反馈报告。';

    const userPrompt = language === 'en'
      ? `Below is a mock interview transcript for a ${session.interview_type} interview.

Job Description:
${session.job_description}

Transcript:
${transcript}

Please generate a comprehensive interview performance report with the following structure (use Markdown):

## Overall Assessment
(2-3 sentences overall evaluation + a score out of 100)

## Strengths
- (3-5 bullet points with specific examples from the interview)

## Areas for Improvement
- (3-5 bullet points with specific examples)

## Question-by-Question Review
(For each question: brief comment on the answer quality)

## Actionable Suggestions
- (3-5 concrete preparation suggestions for real interviews)

Keep the report professional, specific and encouraging.`
      : `以下是一场${session.interview_type}模拟面试的完整记录。

岗位描述：
${session.job_description}

面试记录：
${transcript}

请生成一份全面的面试表现报告，使用 Markdown 格式，结构如下：

## 总体评价
（2-3句话整体评估 + 百分制综合得分）

## 表现亮点
- （3-5条，结合面试中的具体回答举例）

## 待提升之处
- （3-5条，结合具体回答举例）

## 逐题回顾
（针对每个问题：简要点评回答质量）

## 备考建议
- （3-5条可落地的真实面试准备建议）

报告要求专业、具体、有鼓励性。`;

    const llmClient = new LLMClient(new Config(), HeaderUtils.extractForwardHeaders(request.headers));
    const encoder = new TextEncoder();
    let fullContent = '';

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          const stream = llmClient.stream([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ], { temperature: 0.7 });

          for await (const chunk of stream) {
            if (chunk.content) {
              const text = chunk.content.toString();
              fullContent += text;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`));
            }
          }

          // 提取总分（尝试从文本中解析数字分数）
          let overallScore: number | null = null;
          const scoreMatch = fullContent.match(/(\d{1,3})\s*(?:\/\s*100|分)/);
          if (scoreMatch) {
            const parsed = parseInt(scoreMatch[1], 10);
            if (parsed >= 0 && parsed <= 100) overallScore = parsed;
          }

          // 更新会话状态
          await client
            .from('interview_sessions')
            .update({
              status: 'completed',
              summary: fullContent,
              overall_score: overallScore,
              updated_at: new Date().toISOString(),
            })
            .eq('id', sessionId);

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, score: overallScore })}\n\n`));
          controller.close();
        } catch (error) {
          console.error('Summary stream error:', error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '报告生成失败，请重试' })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Interview summary error:', error);
    return new Response(JSON.stringify({ error: '服务器错误' }), { status: 500 });
  }
}
