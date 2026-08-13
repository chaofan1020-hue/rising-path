import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';

function validId(value: string | null): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.dnaRead);
  if (permissionError) return permissionError;
  const companyDnaId = validId(request.nextUrl.searchParams.get('companyDnaId'));
  const company = request.nextUrl.searchParams.get('company')?.trim() || null;
  if (!companyDnaId && !company) {
    return NextResponse.json({ data: null, error: { code: 'DNA_IDENTIFIER_REQUIRED', message: '需要 companyDnaId 或 company' } }, { status: 400 });
  }
  try {
    const client = getSupabaseClient();
    let query = client
      .from('company_dna_versions')
      .select('id,company_dna_id,company_name,version,aliases,dna,source,review_notes,published_by,published_at,created_at')
      .order('version', { ascending: false });
    if (companyDnaId) query = query.eq('company_dna_id', companyDnaId);
    if (company) query = query.ilike('company_name', company);
    const { data, error } = await query.limit(100);
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: data || [], error: null });
  } catch (error) {
    console.error('[Admin DNA Versions] query failed:', error);
    return NextResponse.json({ data: null, error: { code: 'DNA_VERSION_QUERY_FAILED', message: '获取 DNA 版本失败' } }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.dnaPublish);
  if (permissionError) return permissionError;
  try {
    const body = await request.json() as { versionId?: unknown; reviewNotes?: unknown };
    const versionId = Number(body.versionId);
    const reviewNotes = typeof body.reviewNotes === 'string' ? body.reviewNotes.trim().slice(0, 2000) : null;
    if (!Number.isInteger(versionId) || versionId <= 0) {
      return NextResponse.json({ data: null, error: { code: 'INVALID_DNA_VERSION', message: '版本 ID 无效' } }, { status: 400 });
    }
    const { data, error } = await getSupabaseClient().rpc('rollback_company_dna_version', {
      p_version_id: versionId,
      p_published_by: 'legacy_admin_session',
      p_review_notes: reviewNotes,
    });
    if (error) throw new Error(error.message);
    const result = data?.[0] || null;
    await recordAdminAuditEvent({
      request,
      action: 'company_dna.rollback',
      resourceType: 'company_dna',
      resourceId: result?.id || null,
      metadata: { source_version_id: versionId, published_version: result?.version || null },
      afterData: { source_version_id: versionId, published_version: result?.version || null },
    });
    return NextResponse.json({ data: result, error: null });
  } catch (error) {
    await recordAdminAuditFailure({ request, action: 'company_dna.rollback', resourceType: 'company_dna', error });
    console.error('[Admin DNA Versions] rollback failed:', error);
    return NextResponse.json({ data: null, error: { code: 'DNA_VERSION_ROLLBACK_FAILED', message: 'DNA 回滚失败' } }, { status: 500 });
  }
}
