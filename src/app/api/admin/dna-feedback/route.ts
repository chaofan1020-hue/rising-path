// GET /api/admin/dna-feedback?status=pending_review|high_quality|reviewed|all
// 真实度反馈案例列表（审查队列）
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.feedbackRead);
  if (permissionError) return permissionError;

  const client = getSupabaseClient();
  const status = request.nextUrl.searchParams.get('status') || 'pending_review';

  let query = client
    .from('interview_feedback')
    .select('id, session_id, company, realism_score, feedback_text, status, dna_source, dna_version, review_notes, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (status !== 'all') {
    query = query.eq('status', status);
  }
  const { data, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: '查询失败' }), { status: 500 });
  }
  return new Response(JSON.stringify({ items: data || [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
