import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';

export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();

  const { data, error } = await auth.client.rpc('get_user_onboarding_state', {
    p_user_id: auth.user.id,
  });
  if (error || !data) {
    console.error('[Onboarding] Failed to load path state:', error);
    return NextResponse.json({ error: 'Unable to load onboarding progress' }, { status: 500 });
  }

  return NextResponse.json({ onboarding: data });
}
