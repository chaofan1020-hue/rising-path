import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET(request: NextRequest) {
  const token = request.headers.get('x-session');
  if (!token) {
    return NextResponse.json({ user: null, accessCodeId: null }, { status: 401 });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return NextResponse.json({ user: null, accessCodeId: null }, { status: 401 });
  }

  const { data: mapping } = await supabase
    .from('user_access_codes')
    .select('access_code_id')
    .eq('user_id', data.user.id)
    .single();

  return NextResponse.json({
    user: { id: data.user.id, email: data.user.email },
    accessCodeId: mapping?.access_code_id ?? null,
  });
}
