import { NextRequest, NextResponse } from 'next/server';
import { hasValidAdminSession } from '@/lib/admin-auth';
import { syncJobsFeed } from '@/lib/jobs-feed';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const maxDuration = 300;

const CURSOR_CONFIG_TYPE = 'jobs_feed_cursor';

async function getSavedCursor() {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('job_configs')
    .select('id, config_value')
    .eq('config_type', CURSOR_CONFIG_TYPE)
    .order('id', { ascending: true })
    .limit(1);
  if (error) throw new Error(`读取同步进度失败: ${error.message}`);
  return data?.[0] ?? null;
}

async function saveCursor(cursor: string | null) {
  const client = getSupabaseClient();
  const saved = await getSavedCursor();
  const value = cursor || '';
  const mutation = saved
    ? client.from('job_configs').update({ config_value: value, updated_at: new Date().toISOString() }).eq('id', saved.id)
    : client.from('job_configs').insert({ config_type: CURSOR_CONFIG_TYPE, config_value: value, is_active: true });
  const { error } = await mutation;
  if (error) throw new Error(`保存同步进度失败: ${error.message}`);
}

export async function POST(request: NextRequest) {
  if (!hasValidAdminSession(request)) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({})) as {
      cursor?: string;
      since?: string;
      maxPages?: number;
    };
    if (body.cursor && body.since) {
      return NextResponse.json({ error: 'cursor 和 since 只能二选一' }, { status: 400 });
    }
    if (body.since && Number.isNaN(Date.parse(body.since))) {
      return NextResponse.json({ error: 'since 必须是 ISO 日期时间' }, { status: 400 });
    }

    const saved = body.cursor === undefined ? await getSavedCursor() : null;
    const cursor = body.cursor === undefined ? (saved?.config_value || undefined) : body.cursor;
    const result = await syncJobsFeed(getSupabaseClient(), {
      ...body,
      cursor,
      maxPages: body.maxPages ?? 20,
    });
    await saveCursor(result.has_more ? result.next_cursor : null);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('Jobs feed sync failed:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : '招聘数据同步失败',
    }, { status: 502 });
  }
}

export async function GET(request: NextRequest) {
  if (!hasValidAdminSession(request)) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 401 });
  }
  try {
    const saved = await getSavedCursor();
    return NextResponse.json({
      configured: Boolean(process.env.JOBS_FEED_API_KEY || process.env.INTEGRATION_API_KEY),
      next_cursor: saved?.config_value || null,
      description: '每次 POST 默认同步 20 页，并自动保存游标；has_more 为 false 时完成全量同步。',
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '读取同步状态失败',
    }, { status: 500 });
  }
}
