// POST /api/interview/feedback —— 面试真实度问卷提交
// 闭环：评分 <6 → pending_review（低真实度案例，进入人工审查队列）
//       评分 >=6 → high_quality（高质量案例，提问记录保留为训练数据）
import { NextRequest } from 'next/server';
import { getCompanyDNA } from '@/lib/company-dna-service';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const client = auth.client;
    const { sessionId, realismScore, feedbackText } = await request.json();

    if (!sessionId) {
      return new Response(JSON.stringify({ error: '缺少必要参数' }), { status: 400 });
    }
    const score = Number(realismScore);
    if (!Number.isInteger(score) || score < 1 || score > 10) {
      return new Response(JSON.stringify({ error: '评分须为 1-10 的整数' }), { status: 400 });
    }

    // 校验会话归属并取公司（用于关联基因版本）
    const { data: session } = await client
      .from('interview_sessions')
      .select('id, target_company')
      .eq('id', sessionId)
      .eq('user_id', auth.user.id)
      .single();
    if (!session) {
      return new Response(JSON.stringify({ error: '会话不存在' }), { status: 404 });
    }

    // 取当前生效基因版本快照（复用四级获取：manual > curated > cached > generated）
    // 便于追溯"这次评分针对哪版基因"；精调库无版本概念，version 记 null
    const company = session.target_company || '';
    let dnaSource: string | null = null;
    let dnaVersion: number | null = null;
    if (company) {
      try {
        const result = await getCompanyDNA(company, request.headers);
        if (result) {
          dnaSource = result.source;
          dnaVersion = result.version ?? null;
        }
      } catch {
        // 快照失败不阻塞反馈提交
      }
    }

    const status = score < 6 ? 'pending_review' : 'high_quality';
    const { error } = await client.from('interview_feedback').upsert(
      {
        session_id: sessionId,
        user_id: auth.user.id,
        company,
        realism_score: score,
        feedback_text: feedbackText ? String(feedbackText).slice(0, 2000) : null,
        status,
        dna_source: dnaSource,
        dna_version: dnaVersion,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'session_id' }
    );

    if (error) {
      return new Response(JSON.stringify({ error: '提交失败' }), { status: 500 });
    }
    return new Response(JSON.stringify({ success: true, status }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: '服务器错误' }), { status: 500 });
  }
}
