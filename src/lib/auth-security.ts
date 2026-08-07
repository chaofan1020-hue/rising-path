import crypto from 'node:crypto';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { validatePassword } from '@/lib/auth-shared';

export { validatePassword };

interface LocalBucket {
  count: number;
  resetAt: number;
  blockedUntil: number;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

const localBuckets = new Map<string, LocalBucket>();
const MAX_LOCAL_BUCKETS = 10_000;

export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function hashRateLimitKey(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function consumeLocalRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  blockSeconds: number
): RateLimitResult {
  const now = Date.now();
  const current = localBuckets.get(key);
  const windowMs = windowSeconds * 1000;

  if (!current || current.resetAt <= now) {
    localBuckets.set(key, {
      count: 1,
      resetAt: now + windowMs,
      blockedUntil: 0,
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (current.blockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((current.blockedUntil - now) / 1000),
    };
  }

  current.count += 1;
  if (current.count > limit) {
    current.blockedUntil = now + blockSeconds * 1000;
    return { allowed: false, retryAfterSeconds: blockSeconds };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Use the database-backed limiter when its migration is present. The local
 * limiter keeps development usable before migrations are applied; production
 * fails closed if the durable limiter cannot be reached.
 */
export async function consumeAuthRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  blockSeconds: number
): Promise<RateLimitResult> {
  const keyHash = hashRateLimitKey(key);

  try {
    const serviceClient = getSupabaseClient();
    const { data, error } = await serviceClient.rpc('consume_auth_rate_limit', {
      p_key_hash: keyHash,
      p_limit: limit,
      p_window_seconds: windowSeconds,
      p_block_seconds: blockSeconds,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (!error && row && typeof row.allowed === 'boolean') {
      return {
        allowed: row.allowed,
        retryAfterSeconds: Number(row.retry_after_seconds) || 0,
      };
    }
  } catch (error) {
    console.error('[Auth] Persistent rate limiter unavailable:', error);
  }

  if (process.env.NODE_ENV === 'production') {
    return { allowed: false, retryAfterSeconds: 300 };
  }

  if (localBuckets.size > MAX_LOCAL_BUCKETS) {
    localBuckets.clear();
  }
  return consumeLocalRateLimit(keyHash, limit, windowSeconds, blockSeconds);
}

export async function verifyTurnstileToken(
  token: unknown,
  ip: string
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return process.env.NODE_ENV !== 'production';
  if (typeof token !== 'string' || token.length < 10) return false;

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      cache: 'no-store',
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch (error) {
    console.error('[Auth] Turnstile verification failed:', error);
    return false;
  }
}

export function authErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return '请求失败，请稍后重试';
  const message = error.message.toLowerCase();
  if (message.includes('invalid login credentials')) return '邮箱或密码不正确';
  if (message.includes('email not confirmed')) return '请先完成邮箱验证';
  if (message.includes('password')) return '密码不符合安全要求';
  if (message.includes('rate limit')) return '请求过于频繁，请稍后再试';
  return '请求失败，请稍后重试';
}
