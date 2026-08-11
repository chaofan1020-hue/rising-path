import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const { searchParams } = new URL(request.url);
    const domain = searchParams.get('domain') || '';

    let query = auth.client
      .from('form_templates')
      .select('*')
      .eq('is_active', true)
      .order('usage_count', { ascending: false });

    if (domain) query = query.ilike('domain_pattern', `%${domain}%`);

    const { data, error } = await query;
    if (error) throw new Error(`查询表单模板失败: ${error.message}`);
    return NextResponse.json({ templates: data });
  } catch (error) {
    console.error('Error fetching form templates:', error);
    return NextResponse.json({ error: '获取表单模板失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedResponse();
    const body = await request.json();
    const templates = Array.isArray(body.templates) ? body.templates : [body];

    const insertData = templates.map((t: {
      domain_pattern: string;
      ats_type?: string;
      field_key: string;
      semantic_key: string;
      selector_hints?: Record<string, unknown>;
      transform?: string;
    }) => ({
      user_id: auth.user.id,
      domain_pattern: t.domain_pattern,
      ats_type: t.ats_type || null,
      field_key: t.field_key,
      semantic_key: t.semantic_key,
      selector_hints: t.selector_hints || {},
      transform: t.transform || null,
      is_active: true,
    }));

    const { data, error } = await auth.client
      .from('form_templates')
      .upsert(insertData, { onConflict: 'user_id,domain_pattern,field_key' })
      .select();

    if (error) throw new Error(`保存表单模板失败: ${error.message}`);
    return NextResponse.json({ templates: data });
  } catch (error) {
    console.error('Error saving form templates:', error);
    return NextResponse.json({ error: '保存表单模板失败' }, { status: 500 });
  }
}
