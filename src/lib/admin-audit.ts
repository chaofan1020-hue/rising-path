import crypto from 'node:crypto';
import { getSupabaseClient } from '@/storage/database/supabase-client';

type AuditPrimitive = string | number | boolean | null;
type AuditValue = AuditPrimitive | AuditValue[] | { [key: string]: AuditValue };

export interface AdminAuditInput {
  request?: Request;
  action: string;
  resourceType: string;
  resourceId?: string | number | null;
  subjectUserId?: string | null;
  metadata?: Record<string, unknown>;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  success?: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
}

const SENSITIVE_KEY = /(password|secret|token|authorization|cookie|api[_-]?key|access[_-]?key|private[_-]?key|raw[_-]?content|parsed[_-]?content|messages?)/i;
const MAX_STRING_LENGTH = 500;

function toAuditValue(value: unknown, key = ''): AuditValue {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (typeof value === 'string') return value.slice(0, MAX_STRING_LENGTH);
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => toAuditValue(item, key));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).slice(0, 100).map(([childKey, childValue]) => [childKey, toAuditValue(childValue, childKey)]),
    );
  }
  return String(value).slice(0, MAX_STRING_LENGTH);
}

export function sanitizeAdminAuditRecord(value?: Record<string, unknown> | null): Record<string, AuditValue> | null {
  if (!value) return null;
  return toAuditValue(value) as Record<string, AuditValue>;
}

function requestFingerprint(request?: Request): string | null {
  if (!request) return null;
  const authorization = request.headers.get('authorization') || '';
  const cookie = request.headers.get('cookie') || '';
  const sessionMaterial = `${authorization}|${cookie}`;
  return sessionMaterial.length > 1
    ? crypto.createHash('sha256').update(sessionMaterial).digest('hex').slice(0, 32)
    : null;
}

export async function recordAdminAuditEvent(input: AdminAuditInput): Promise<void> {
  const requestId = crypto.randomUUID();
  const request = input.request;
  const payload = {
    actor_type: 'admin_session',
    actor_fingerprint: requestFingerprint(request),
    action: input.action.slice(0, 100),
    resource_type: input.resourceType.slice(0, 100),
    resource_id: input.resourceId === null || input.resourceId === undefined ? null : String(input.resourceId).slice(0, 100),
    subject_user_id: input.subjectUserId || null,
    metadata: toAuditValue(input.metadata || {}),
    before_data: sanitizeAdminAuditRecord(input.beforeData),
    after_data: sanitizeAdminAuditRecord(input.afterData),
    success: input.success !== false,
    error_code: input.errorCode?.slice(0, 100) || null,
    error_message: input.errorMessage?.slice(0, 500) || null,
    request_id: requestId,
    request_ip: request?.headers.get('x-real-ip')?.slice(0, 100) || null,
    user_agent: request?.headers.get('user-agent')?.slice(0, 500) || null,
  };

  try {
    const { error } = await getSupabaseClient().from('admin_audit_logs').insert(payload);
    if (error) console.error('[AdminAudit] write failed:', error.message);
  } catch (error) {
    console.error('[AdminAudit] write failed:', error);
  }
}

export function recordAdminAuditFailure(input: Omit<AdminAuditInput, 'success'> & { error?: unknown }): Promise<void> {
  const errorMessage = input.error instanceof Error ? input.error.message : input.error ? String(input.error) : null;
  return recordAdminAuditEvent({
    ...input,
    success: false,
    errorMessage,
  });
}
