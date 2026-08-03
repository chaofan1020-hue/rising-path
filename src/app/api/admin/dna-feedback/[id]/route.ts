// GET /api/admin/dna-feedback/[id] —— 案例详情（含面试对话记录与当前基因快照）
// PATCH /api/admin/dna-feedback/[id] —— 标记已处理（reviewed + review_notes）
import { NextRequest } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCompanyDNA } from '@/lib/company-dna-service';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = getSupabaseClient();

  const { data: feedback } = await client.from('interview_feedback').select('*').eq('id', id).single();
  if (!feedback) {
    return new Response(JSON.stringify({ error: '案例不存在' }), { status: 404 });
  }

  // 面试对话记录（审查差异点：候选人反馈"哪里不真实"时对照提问记录）
  const { data: session } = await client
    .from('interview_sessions')
    .select('id, interview_type, mode, total_rounds, job_description, messages, created_at')
    .eq('id', feedback.session_id)
    .single();

  // 当前生效基因（人工版 > 精调 > 生成缓存，保证编辑器总有完整内容可改）
  const dnaResult = feedback.company
    ? await getCompanyDNA(feedback.company, request.headers).catch(() => null)
    : null;

  return new Response(
    JSON.stringify({
      feedback,
      session: session || null,
      currentDNA: dnaResult
        ? { dna: dnaResult.dna, source: dnaResult.source, version: dnaResult.version }
        : null,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = getSupabaseClient();
  const body = await request.json();
  const { status, reviewNotes } = body;

  if (status && !['reviewed', 'pending_review', 'high_quality'].includes(status)) {
    return new Response(JSON.stringify({ error: '非法状态' }), { status: 400 });
  }

  const { error } = await client
    .from('interview_feedback')
    .update({
      ...(status ? { status } : {}),
      ...(reviewNotes !== undefined ? { review_notes: String(reviewNotes).slice(0, 2000) } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    return new Response(JSON.stringify({ error: '更新失败' }), { status: 500 });
  }
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
