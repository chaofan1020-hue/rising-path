import type { EmailOtpType, Session, User } from '@supabase/supabase-js';
import { getSupabaseAnonClient, getSupabaseClient } from '@/storage/database/supabase-client';

export const LOGIN_EMAIL_OTP_TYPES: EmailOtpType[] = ['email', 'magiclink'];
export const ADMIN_LOGIN_EMAIL_OTP_TYPES: EmailOtpType[] = ['email', 'magiclink', 'signup'];

function isAuthFunctionMissing(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('could not find the function')
    || normalized.includes('schema cache')
    || normalized.includes('does not exist');
}

export async function confirmAuthUserEmail(userId: string): Promise<void> {
  const client = getSupabaseClient();
  const { data: confirmed, error: rpcError } = await client.rpc('confirm_auth_user_email', {
    p_user_id: userId,
  });
  if (rpcError) {
    if (!isAuthFunctionMissing(rpcError.message)) throw new Error(rpcError.message);
    const updated = await client.auth.admin.updateUserById(userId, { email_confirm: true });
    if (updated.error) throw new Error(updated.error.message);
  } else if (confirmed !== true) {
    throw new Error('账号不存在');
  }

  const { data, error } = await client.auth.admin.getUserById(userId);
  if (error || !data.user) throw new Error(error?.message || '账号不存在');
  if (!data.user.email_confirmed_at) {
    throw new Error('无法确认该邮箱，登录验证码会误发成注册链接');
  }
}

export async function sendLoginEmailOtp(email: string): Promise<void> {
  const { error } = await getSupabaseAnonClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  if (error) throw error;
}

export async function verifyLoginEmailOtp(
  email: string,
  token: string,
  types: readonly EmailOtpType[] = LOGIN_EMAIL_OTP_TYPES,
): Promise<{ user: User | null; session: Session | null; error: { message?: string } | null }> {
  const supabase = getSupabaseAnonClient();
  let lastError: { message?: string } | null = null;
  for (const type of types) {
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type });
    if (!error && data.user) return { user: data.user, session: data.session, error: null };
    lastError = error;
  }
  return { user: null, session: null, error: lastError };
}
