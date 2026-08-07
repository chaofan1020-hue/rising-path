// GET /api/company-dna?name=XX —— 获取企业面试基因（精调/缓存/生成）
// 前端设置页输入目标公司后调用，展示基因预览；返回摘要信息即可（完整基因用于服务端注入 prompt）
// PATCH /api/company-dna —— 人工更新基因（审查闭环：版本 +1，后续面试即启用新版 prompt）
import { NextRequest } from 'next/server';
import { getCompanyDNA, saveManualDNA } from '@/lib/company-dna-service';
import { CompanyDNA } from '@/lib/company-dna';
import { hasValidAdminSession } from '@/lib/admin-auth';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';

export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();

  const name = request.nextUrl.searchParams.get('name')?.trim();
  if (!name) {
    return new Response(JSON.stringify({ error: '缺少公司名称' }), { status: 400 });
  }

  const result = await getCompanyDNA(name, request.headers);
  if (!result) {
    return new Response(JSON.stringify({ error: '基因生成失败' }), { status: 500 });
  }

  const { dna, source, version } = result;
  return new Response(
    JSON.stringify({
      company: dna.company,
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
    if (!hasValidAdminSession(request)) {
      return new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 401 });
    }

    const body = await request.json();
    const { company, dna, reviewNotes } = body;
    if (!company || typeof company !== 'string') {
      return new Response(JSON.stringify({ error: '缺少公司名称' }), { status: 400 });
    }
    if (!dna || typeof dna !== 'object' || !Array.isArray(dna.focusAreas) || dna.focusAreas.length === 0) {
      return new Response(JSON.stringify({ error: '基因结构不完整（focusAreas 必填）' }), { status: 400 });
    }
    const result = await saveManualDNA(company.trim(), dna as CompanyDNA, reviewNotes);
    if (!result) {
      return new Response(JSON.stringify({ error: '保存失败' }), { status: 500 });
    }
    return new Response(JSON.stringify({ success: true, version: result.version }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: '服务器错误' }), { status: 500 });
  }
}
