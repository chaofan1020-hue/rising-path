// GET /api/company-dna?name=XX —— 获取企业面试基因（精调/缓存/生成）
// 前端设置页输入目标公司后调用，展示基因预览；返回摘要信息即可（完整基因用于服务端注入 prompt）
// PATCH /api/company-dna —— 人工更新基因（审查闭环：版本 +1，后续面试即启用新版 prompt）
import { NextRequest } from 'next/server';
import { getCompanyDNA, saveManualDNA } from '@/lib/company-dna-service';
import { CompanyDNA } from '@/lib/company-dna';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { consumeAuthRateLimit } from '@/lib/auth-security';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';

export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();

  const rateLimit = await consumeAuthRateLimit(`company-dna:user:${auth.user.id}`, 10, 600, 1800);
  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({ error: '企业基因查询过于频繁，请稍后再试' }), {
      status: 429,
      headers: { 'Retry-After': String(Math.max(rateLimit.retryAfterSeconds, 60)) },
    });
  }

  const name = request.nextUrl.searchParams.get('name')?.trim();
  if (!name || name.length > 255) {
    return new Response(JSON.stringify({ error: '缺少公司名称' }), { status: 400 });
  }

  // Preview is deliberately read-only. Unknown companies are generated only
  // once the user explicitly starts a session, where cost can be attributed.
  const result = await getCompanyDNA(name, request.headers, {}, { allowGeneration: false });
  if (!result) {
    return new Response(JSON.stringify({
      company: name,
      available: false,
      message: '该公司尚无面试基因，将在开始面试时生成。',
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  const { dna, source, version } = result;
  return new Response(
    JSON.stringify({
      company: dna.company,
      available: true,
      source,
      version,
      tagline: dna.tagline,
      focusAreas: dna.focusAreas.map((f) => ({ dimension: f.dimension, weight: f.weight })),
      tone: dna.style.tone,
      cultureKeywords: dna.cultureKeywords,
      signatureQuestions: dna.signatureQuestions.slice(0, 3),
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

// PATCH：人工更新基因（来自审查页）。body: { company, dna, reviewNotes? }
export async function PATCH(request: NextRequest) {
  try {
    const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.dnaPublish);
    if (permissionError) return permissionError;

    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return new Response(JSON.stringify({ error: '请求体格式错误' }), { status: 400 });
    }
    const { company, dna, reviewNotes } = body as {
      company?: unknown;
      dna?: unknown;
      reviewNotes?: unknown;
    };
    if (typeof company !== 'string' || !company.trim() || company.trim().length > 255) {
      return new Response(JSON.stringify({ error: '缺少公司名称' }), { status: 400 });
    }
    if (reviewNotes !== undefined && (typeof reviewNotes !== 'string' || reviewNotes.length > 5_000)) {
      return new Response(JSON.stringify({ error: '审查备注不能超过 5000 字' }), { status: 400 });
    }
    const focusAreas = dna && typeof dna === 'object' && !Array.isArray(dna)
      ? (dna as { focusAreas?: unknown }).focusAreas
      : undefined;
    if (!Array.isArray(focusAreas) || focusAreas.length === 0) {
      return new Response(JSON.stringify({ error: '基因结构不完整（focusAreas 必填）' }), { status: 400 });
    }
    const result = await saveManualDNA(company.trim(), dna as CompanyDNA, reviewNotes as string | undefined);
    if (!result) {
      return new Response(JSON.stringify({ error: '保存失败' }), { status: 500 });
    }
    await recordAdminAuditEvent({
      request,
      action: 'company_dna.update',
      resourceType: 'company_dna',
      resourceId: company.trim(),
      metadata: { company: company.trim(), version: result.version },
      afterData: { company: company.trim(), version: result.version, review_notes: reviewNotes },
    });
    return new Response(JSON.stringify({ success: true, version: result.version }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    await recordAdminAuditFailure({ request, action: 'company_dna.update', resourceType: 'company_dna', error });
    return new Response(JSON.stringify({ error: '服务器错误' }), { status: 500 });
  }
}
