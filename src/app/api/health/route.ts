import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const { error } = await getSupabaseClient().from('jobs').select('id', { head: true }).limit(1);
    if (error) throw error;

    return NextResponse.json(
      { status: 'ok' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[Health] Supabase connectivity check failed:', error);
    return NextResponse.json(
      { status: 'degraded' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
