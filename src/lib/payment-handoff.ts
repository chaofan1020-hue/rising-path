import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { normalizePaymentReturnPath, paymentReturnUrl, type PaymentReturnPath } from '@/lib/payment-return';

const TICKET_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

function secret(): string {
  const value = process.env.PAYMENT_HANDOFF_SECRET?.trim();
  if (!value || value.length < 32) throw new Error('PAYMENT_HANDOFF_SECRET must be at least 32 characters');
  return value;
}

export function handoffDigest(value: string): string {
  return createHmac('sha256', secret()).update(value).digest('hex');
}

export function createHandoffTicket(): { token: string; hash: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: handoffDigest(token), expiresAt: new Date(Date.now() + TICKET_TTL_MS).toISOString() };
}

export function verifyHandoffTicket(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(handoffDigest(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

type SessionPayload = { orderId: number; userId: string; returnPath: PaymentReturnPath; exp: number; nonce: string };

export function signPaymentSession(input: { orderId: number; userId: string; returnPath?: unknown }): string {
  const payload: SessionPayload = { orderId: input.orderId, userId: input.userId, returnPath: normalizePaymentReturnPath(input.returnPath), exp: Date.now() + SESSION_TTL_MS, nonce: randomBytes(12).toString('hex') };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${handoffDigest(encoded)}`;
}

export function verifyPaymentSession(value: string | undefined): SessionPayload | null {
  if (!value) return null;
  const [encoded, signature] = value.split('.');
  if (!encoded || !signature || !verifyHandoffTicket(encoded, signature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!Number.isInteger(payload.orderId) || !payload.userId || payload.exp <= Date.now()) return null;
    return { ...payload, returnPath: normalizePaymentReturnPath(payload.returnPath) };
  } catch { return null; }
}

export function paymentSiteUrl(requestOrigin: string): string {
  return process.env.PAYMENT_SITE_URL?.trim() || requestOrigin;
}

export { paymentReturnUrl };

export const PAYMENT_SESSION_COOKIE = 'liorvix_payment_session';
export const PAYMENT_SESSION_MAX_AGE = Math.floor(SESSION_TTL_MS / 1000);
