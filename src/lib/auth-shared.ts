import type { User } from '@supabase/supabase-js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailVerified(user: User): boolean {
  return !user.email || Boolean(user.email_confirmed_at);
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

export function validatePassword(password: string): string | null {
  if (password.length < 12) return '密码至少需要 12 位';
  if (password.length > 128) return '密码不能超过 128 位';
  if (/\s/.test(password)) return '密码不能包含空格';
  if (!/[a-z]/.test(password)) return '密码需要包含小写字母';
  if (!/[A-Z]/.test(password)) return '密码需要包含大写字母';
  if (!/[0-9]/.test(password)) return '密码需要包含数字';
  if (!/[^A-Za-z0-9]/.test(password)) return '密码需要包含特殊字符';
  return null;
}
