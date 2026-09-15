import crypto from 'node:crypto';
import { CappedMap, createChallenge, randomInt } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import { deriveHmacKeySecret, verify } from 'altcha-lib/frameworks/shared';

const PLACEHOLDER_PATTERN = /your[-_]|placeholder|replace|changeme|example/i;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const DEV_HMAC_SECRET = 'dev-only-altcha-hmac-secret-do-not-use-in-production';

interface AltchaRuntime {
  hmacSignatureSecret: string;
  hmacKeySignatureSecret: string;
  store: CappedMap<string, boolean>;
}

let runtimePromise: Promise<AltchaRuntime | null> | null = null;

function isPlaceholderSecret(value: string): boolean {
  return PLACEHOLDER_PATTERN.test(value);
}

export function getAltchaHmacSecret(): string | null {
  const explicit = process.env.ALTCHA_HMAC_SECRET?.trim() || '';
  if (explicit.length >= 16 && !isPlaceholderSecret(explicit)) {
    return explicit;
  }

  const fallback = [
    process.env.ADMIN_SESSION_SECRET,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  ].find((value) => typeof value === 'string' && value.trim().length >= 16);

  if (fallback) {
    return crypto.createHmac('sha256', 'liorvix-altcha-v1').update(fallback.trim()).digest('hex');
  }

  if (process.env.NODE_ENV !== 'production') {
    return DEV_HMAC_SECRET;
  }

  return null;
}

export function isCaptchaEnabled(): boolean {
  if (process.env.AUTH_CAPTCHA === 'off') return false;
  return Boolean(getAltchaHmacSecret());
}

async function getRuntime(): Promise<AltchaRuntime | null> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const hmacSignatureSecret = getAltchaHmacSecret();
      if (!hmacSignatureSecret) return null;
      return {
        hmacSignatureSecret,
        hmacKeySignatureSecret: await deriveHmacKeySecret(hmacSignatureSecret),
        store: new CappedMap<string, boolean>({ maxSize: 5_000 }),
      };
    })();
  }
  return runtimePromise;
}

export async function createAltchaChallenge() {
  const runtime = await getRuntime();
  if (!runtime) {
    throw new Error('人机验证未配置');
  }

  return createChallenge({
    algorithm: 'PBKDF2/SHA-256',
    cost: 4_000,
    counter: randomInt(8_000, 3_000),
    deriveKey,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    hmacKeySignatureSecret: runtime.hmacKeySignatureSecret,
    hmacSignatureSecret: runtime.hmacSignatureSecret,
  });
}

export function readCaptchaToken(body: Record<string, unknown>): unknown {
  return body.captchaToken ?? body.altcha ?? body.turnstileToken;
}

export async function verifyAltchaPayload(token: unknown): Promise<boolean> {
  if (!isCaptchaEnabled()) return true;
  if (typeof token !== 'string' || token.length < 20) return false;

  const runtime = await getRuntime();
  if (!runtime) return false;

  const result = await verify(
    token,
    deriveKey,
    runtime.hmacSignatureSecret,
    runtime.hmacKeySignatureSecret,
    runtime.store,
  );
  return result.verification?.verified === true;
}
