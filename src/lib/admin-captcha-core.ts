export const ADMIN_CAPTCHA_DIFFICULTY = 3;
export const ADMIN_CAPTCHA_TTL_MS = 5 * 60 * 1000;

export type AdminCaptchaChallenge = {
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  difficulty: number;
  signature: string;
};

export type AdminCaptchaSolution = AdminCaptchaChallenge & {
  counter: number;
};

export function isAdminCaptchaChallenge(value: unknown): value is AdminCaptchaChallenge {
  if (!value || typeof value !== 'object') return false;
  const challenge = value as Record<string, unknown>;
  return (
    typeof challenge.nonce === 'string'
    && /^[0-9a-f]{16,64}$/i.test(challenge.nonce)
    && typeof challenge.issuedAt === 'number'
    && typeof challenge.expiresAt === 'number'
    && typeof challenge.difficulty === 'number'
    && Number.isInteger(challenge.difficulty)
    && challenge.difficulty > 0
    && challenge.difficulty <= 6
    && typeof challenge.signature === 'string'
    && challenge.signature.length > 8
  );
}

export function adminCaptchaSigningPayload(challenge: Omit<AdminCaptchaChallenge, 'signature'>): string {
  return `${challenge.nonce}:${challenge.issuedAt}:${challenge.expiresAt}:${challenge.difficulty}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hashMeetsDifficulty(hash: string, difficulty: number): boolean {
  return hash.startsWith('0'.repeat(difficulty));
}

export async function solveAdminCaptcha(challenge: AdminCaptchaChallenge): Promise<AdminCaptchaSolution> {
  const maxAttempts = Math.max(256, 16 ** challenge.difficulty * 8);
  for (let counter = 0; counter < maxAttempts; counter += 1) {
    const hash = await sha256Hex(`${challenge.nonce}:${counter}`);
    if (hashMeetsDifficulty(hash, challenge.difficulty)) {
      return { ...challenge, counter };
    }
    if (counter % 32 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw new Error('安全验证超时，请重试');
}
