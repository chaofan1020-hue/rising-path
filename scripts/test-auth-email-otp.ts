import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ADMIN_LOGIN_EMAIL_OTP_TYPES, LOGIN_EMAIL_OTP_TYPES } from '@/lib/auth-email-otp';

function main() {
  assert.deepEqual(LOGIN_EMAIL_OTP_TYPES, ['email', 'magiclink']);
  assert.deepEqual(ADMIN_LOGIN_EMAIL_OTP_TYPES, ['email', 'magiclink', 'signup']);

  const migration = readFileSync(
    path.join(process.cwd(), 'supabase/migrations/0125_confirm_auth_user_email.sql'),
    'utf8',
  );
  assert.match(migration, /create or replace function public\.confirm_auth_user_email/);
  assert.match(migration, /email_confirmed_at = coalesce\(email_confirmed_at, now\(\)\)/);
  assert.match(migration, /confirmation_token = ''/);
  assert.match(migration, /email_verified/);
  assert.match(migration, /grant execute on function public\.confirm_auth_user_email\(uuid\) to service_role/);
  assert.match(migration, /notify pgrst, 'reload schema'/);

  console.log('Auth email OTP type order and confirm migration checks passed');
}

main();
