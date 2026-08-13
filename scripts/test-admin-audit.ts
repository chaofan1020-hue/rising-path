import assert from 'node:assert/strict';
import { sanitizeAdminAuditRecord } from '@/lib/admin-audit';

const sanitized = sanitizeAdminAuditRecord({
  password: 'should-not-appear',
  authorization: 'Bearer secret',
  profile: { parsed_content: 'private resume text', display_name: 'Student' },
  metadata: { count: 2, nested: true },
});

assert.equal(sanitized?.password, '[REDACTED]');
assert.equal(sanitized?.authorization, '[REDACTED]');
assert.equal((sanitized?.profile as Record<string, unknown>).parsed_content, '[REDACTED]');
assert.equal((sanitized?.profile as Record<string, unknown>).display_name, 'Student');
assert.equal((sanitized?.metadata as Record<string, unknown>).count, 2);

console.log('Admin audit sanitization checks passed');
