import assert from 'node:assert/strict';
import { createAdminSessionToken, verifyAdminSessionToken } from '@/lib/admin-session-token';

process.env.ADMIN_SESSION_SECRET = 'admin-session-token-test-secret';

async function main() {
  const token = await createAdminSessionToken(Math.floor(Date.now() / 1000), 'content_admin', {
    sessionId: '11111111-1111-4111-8111-111111111111',
    adminUserId: '22222222-2222-4222-8222-222222222222',
  });
  const payload = await verifyAdminSessionToken(token);
  assert.equal(payload?.role, 'content_admin');
  assert.equal(payload?.sessionId, '11111111-1111-4111-8111-111111111111');
  assert.equal(await verifyAdminSessionToken('not-a-token'), null);
  assert.equal(await verifyAdminSessionToken(token.slice(0, -2) + 'aa'), null);
  console.log('Admin session token checks passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
