import { NextRequest } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';

interface ChatMessage {
  role: 'interviewer' | 'candidate';
  content: string;
}

const TYPE_LABELS: Record<string, { zh: string; en: string }> = {
  technical: { zh: '技术面试', en: 'Technical Interview' },
  behavioral: { zh: '行为面试', en: 'Behavioral Interview' },
  case: { zh: '案例面试', en: 'Case Interview' },
  mixed: { zh: '综合面试', en: 'Mixed Interview' },
};

function buildSystemPrompt(interviewType: string, jobDescription: string, language: string) {
  const typeLabel = TYPE_LABELS[interviewType]?.[language === 'en' ? 'en' : 'zh'] || interviewType;

  if (language === 'en') {
    return `You are a professional interviewer at a top company, conducting a ${typeLabel} for the following position:

${jobDescription}

Rules you MUST follow:
1. Act as a real interviewer. Be professional, sharp, and realistic — not overly friendly.
2. Conduct the interview entirely in English.
3. Start with a brief greeting and your first question in your FIRST response.
4. For each candidate answer:
   - Give concise, honest feedback (2-4 sentences): point out strengths AND specific weaknesses.
   - Then naturally transition to your next question.
   - Occasionally ask follow-up questions to dig deeper if an answer is vague.
5. Ask questions that are realistic for this specific role. Reference the job description.
6. Cover different dimensions across the interview (e.g., experience, skills, problem-solving, culture fit).
7. Output format for each turn: plain text. Start with "[Feedback]" section (only if evaluating an answer), then "[Question]" section.
8. Keep each response under 250 words. Be conversational, not robotic.`;
  }

  return `你是一位顶级公司的资深面试官，正在为以下岗位进行一场${typeLabel}：

${jobDescription}

你必须遵守以下规则：
1. 扮演真实的面试官：专业、犀利、务实，不要过分客套。
2. 全程使用中文进行面试。
3. 第一轮回复：简短开场白 + 第一个面试问题。
4. 对候选人的每次回答：
   - 先给出简洁、诚恳的点评（2-4句话）：指出亮点和具体的不足。
   - 然后自然过渡到你的下一个问题。
   - 如果回答含糊，可以适当追问深挖。
5. 提问要贴合该岗位的真实面试场景，结合岗位描述中的要求。
6. 整场面试要覆盖不同维度（如：项目经验、专业技能、问题解决、团队协作风等）。
7. 每轮输出格式：纯文本。先输出"[点评]"部分（仅在评价回答时），再输出"[提问]"部分。
8. 每轮回复控制在250字以内，像真人对话一样自然，不要机械。`;
}

export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient();
    const body = await request.json();
    const {
      accessCodeId,
      sessionId,
      interviewType,
      jobDescription,
      resumeId,
      answer,
      language = 'zh',
    } = body;

    if (!accessCodeId) {
      return new Response(JSON.stringify({ error: '未授权的访问' }), { status: 401 });
    }

    let messages: ChatMessage[] = [];
    let currentSessionId = sessionId;
    let systemPrompt = '';

    if (!currentSessionId) {
      // 开始新面试
      if (!interviewType) {
        return new Response(JSON.stringify({ error: '缺少面试类型' }), { status: 400 });
      }

      const jdText = jobDescription || (language === 'en' ? 'General position (no specific JD provided)' : '通用岗位（未提供具体 JD）');

      // 可选：结合简历内容
      let resumeContext = '';
      if (resumeId) {
        const { data: resume } = await client
          .from('resumes')
          .select('parsed_content, file_name')
          .eq('id', resumeId)
          .eq('access_code_id', accessCodeId)
          .single();
        if (resume?.parsed_content) {
          resumeContext = language === 'en'
            ? `\n\nCandidate's resume:\n${resume.parsed_content}\n\nUse this resume to ask personalized questions about the candidate's specific experiences and projects.`
            : `\n\n候选人简历：\n${resume.parsed_content}\n\n请结合简历中候选人的具体经历和项目进行针对性提问。`;
        }
      }

      systemPrompt = buildSystemPrompt(interviewType, jdText + resumeContext, language);
      const llmMessages = [
        { role: 'system' as const, content: systemPrompt },
        {
          role: 'user' as const,
          content: language === 'en'
            ? 'The candidate has arrived. Please greet them briefly and ask your first interview question.'
            : '候选人已到，请简短开场并提出你的第一个面试问题。',
        },
      ];

      // 先创建会话记录
      const { data: session, error: insertError } = await client
        .from('interview_sessions')
        .insert({
          access_code_id: accessCodeId,
          interview_type: interviewType,
          job_description: jobDescription || '',
          messages: [],
        })
        .select('id')
        .single();

      if (insertError || !session) {
        return new Response(JSON.stringify({ error: '创建面试会话失败' }), { status: 500 });
      }

      currentSessionId = session.id;

      // 流式生成第一个问题
      const llmClient = new LLMClient(new Config(), HeaderUtils.extractForwardHeaders(request.headers));
      const encoder = new TextEncoder();
      let fullContent = '';

      const readableStream = new ReadableStream({
        async start(controller) {
          try {
            // 先发送 sessionId
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ sessionId: currentSessionId })}\n\n`));

            const stream = llmClient.stream(llmMessages, { temperature: 0.8 });
            for await (const chunk of stream) {
              if (chunk.content) {
                const text = chunk.content.toString();
                fullContent += text;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`));
              }
            }

            // 保存面试官的第一条消息
            const newMessages: ChatMessage[] = [{ role: 'interviewer', content: fullContent }];
            await client
              .from('interview_sessions')
              .update({ messages: newMessages, updated_at: new Date().toISOString() })
              .eq('id', currentSessionId);

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
            controller.close();
          } catch (error) {
            console.error('Interview stream error:', error);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '面试生成失败，请重试' })}\n\n`));
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
    }

    // 继续面试：候选人提交了回答
    const { data: session, error: sessionError } = await client
      .from('interview_sessions')
      .select('*')
      .eq('id', currentSessionId)
      .eq('access_code_id', accessCodeId)
      .single();

    if (sessionError || !session) {
      return new Response(JSON.stringify({ error: '面试会话不存在' }), { status: 404 });
    }

    if (session.status !== 'in_progress') {
      return new Response(JSON.stringify({ error: '面试已结束' }), { status: 400 });
    }

    messages = (session.messages as ChatMessage[]) || [];
    systemPrompt = buildSystemPrompt(session.interview_type, session.job_description || '', language);

    // 追加候选人回答
    messages.push({ role: 'candidate', content: answer });

    // 构建 LLM 消息历史
    const llmMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];
    for (const msg of messages) {
      llmMessages.push({
        role: msg.role === 'interviewer' ? 'assistant' : 'user',
        content: msg.content,
      });
    }
    llmMessages.push({
      role: 'user',
      content: language === 'en'
        ? 'Please evaluate my answer above, then ask your next question.'
        : '请点评我上面的回答，然后提出你的下一个问题。',
    });

    const llmClient = new LLMClient(new Config(), HeaderUtils.extractForwardHeaders(request.headers));
    const encoder = new TextEncoder();
    let fullContent = '';

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          const stream = llmClient.stream(llmMessages, { temperature: 0.8 });
          for await (const chunk of stream) {
            if (chunk.content) {
              const text = chunk.content.toString();
              fullContent += text;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`));
            }
          }

          // 保存面试官回复
          const newMessages: ChatMessage[] = [...messages, { role: 'interviewer', content: fullContent }];
          await client
            .from('interview_sessions')
            .update({ messages: newMessages, updated_at: new Date().toISOString() })
            .eq('id', currentSessionId);

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          controller.close();
        } catch (error) {
          console.error('Interview stream error:', error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '面试生成失败，请重试' })}\n\n`));
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
    console.error('Interview chat error:', error);
    return new Response(JSON.stringify({ error: '服务器错误' }), { status: 500 });
  }
}
