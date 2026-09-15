import { getAdminSessionSecret } from '@/lib/admin-session-token';
import {
  ADMIN_CAPTCHA_DIFFICULTY,
  ADMIN_CAPTCHA_TTL_MS,
  adminCaptchaSigningPayload,
  hashMeetsDifficulty,
  isAdminCaptchaChallenge,
  sha256Hex,
  type AdminCaptchaChallenge,
  type AdminCaptchaSolution,
} from '@/lib/admin-captcha-core';

const usedNonces = new Map<string, number>();

function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < arr.length; i += 1) binary += String.fromCharCode(arr[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacSign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return bytesToBase64Url(signature);
}

function signaturesMatch(left: string, right: string): boolean {
  const leftBytes = base64UrlToBytes(left);
  const rightBytes = base64UrlToBytes(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let mismatch = 0;
  for (let i = 0; i < leftBytes.length; i += 1) mismatch |= leftBytes[i]! ^ rightBytes[i]!;
  return mismatch === 0;
}

function pruneUsedNonces(now: number) {
  if (usedNonces.size < 2000) return;
  for (const [nonce, expiresAt] of usedNonces) {
    if (expiresAt <= now) usedNonces.delete(nonce);
  }
  if (usedNonces.size > 4000) usedNonces.clear();
}

function consumeNonce(nonce: string, expiresAt: number): boolean {
  const now = Date.now();
  pruneUsedNonces(now);
  if (usedNonces.has(nonce)) return false;
  usedNonces.set(nonce, expiresAt);
  return true;
}

export async function createAdminCaptchaChallenge(now = Date.now()): Promise<AdminCaptchaChallenge> {
  const secret = getAdminSessionSecret();
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is required');

  const challenge = {
    nonce: randomNonce(),
    issuedAt: now,
    expiresAt: now + ADMIN_CAPTCHA_TTL_MS,
    difficulty: ADMIN_CAPTCHA_DIFFICULTY,
  };
  return {
    ...challenge,
    signature: await hmacSign(adminCaptchaSigningPayload(challenge), secret),
  };
}

export async function verifyAdminCaptchaSolution(value: unknown, now = Date.now()): Promise<boolean> {
  const secret = getAdminSessionSecret();
  if (!secret) return false;
  if (!value || typeof value !== 'object') return false;

  if (!isAdminCaptchaChallenge(value)) return false;
  const counter = (value as Partial<AdminCaptchaSolution>).counter;
  if (typeof counter !== 'number' || !Number.isInteger(counter) || counter < 0) {
    return false;
  }
  if (value.difficulty !== ADMIN_CAPTCHA_DIFFICULTY) return false;
  if (value.expiresAt <= now || value.issuedAt > now + 30_000) return false;

  const expected = await hmacSign(adminCaptchaSigningPayload(value), secret);
  if (!signaturesMatch(value.signature, expected)) return false;
  if (!consumeNonce(value.nonce, value.expiresAt)) return false;

  const hash = await sha256Hex(`${value.nonce}:${counter}`);
  return hashMeetsDifficulty(hash, value.difficulty);
}
