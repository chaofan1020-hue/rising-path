import crypto from 'node:crypto';
import { confirmAuthUserEmail } from '@/lib/auth-email-otp';
import { getSupabaseClient } from '@/storage/database/supabase-client';

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
}

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const { data, error } = await getSupabaseClient().rpc('find_auth_user_id_by_email', { p_email: email });
  if (error) throw new Error(error.message);
  return isUuid(data) ? data : null;
}

export async function ensureAuthUserIdByEmail(email: string): Promise<string> {
  const existing = await findAuthUserIdByEmail(email);
  if (existing) {
    await confirmAuthUserEmail(existing);
    return existing;
  }

  const client = getSupabaseClient();
  const created = await client.auth.admin.createUser({
    email,
    password: `${crypto.randomBytes(24).toString('base64url')}Aa1!`,
    email_confirm: true,
    user_metadata: { invited_as_admin: true },
  });
  const createdId = created.data.user?.id;
  if (createdId) {
    await confirmAuthUserEmail(createdId);
    return createdId;
  }

  const raced = await findAuthUserIdByEmail(email);
  if (raced) {
    await confirmAuthUserEmail(raced);
    return raced;
  }
  throw new Error(created.error?.message || '无法为该邮箱创建平台账号');
}
