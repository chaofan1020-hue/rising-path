import assert from 'node:assert/strict';
import { adminOriginsMatch, isAllowedAdminOrigin } from '@/lib/admin-origin';

process.env.AUTH_SITE_URL = 'https://liorvix.com';

async function main() {
  assert.equal(adminOriginsMatch('https://liorvix.com', 'https://liorvix.com'), true);
  assert.equal(adminOriginsMatch('https://www.liorvix.com', 'https://liorvix.com'), true);
  assert.equal(adminOriginsMatch('https://liorvix.com', 'https://www.liorvix.com'), true);
  assert.equal(adminOriginsMatch('https://evil.example', 'https://liorvix.com'), false);
  assert.equal(adminOriginsMatch('https://wwwliorvix.com', 'https://liorvix.com'), false);

  const allowed = new Request('https://liorvix.com/api/admin/accounts', {
    method: 'POST',
    headers: { origin: 'https://www.liorvix.com' },
  });
  assert.equal(isAllowedAdminOrigin(allowed), true);

  const blocked = new Request('https://liorvix.com/api/admin/accounts', {
    method: 'POST',
    headers: { origin: 'https://example.com' },
  });
  assert.equal(isAllowedAdminOrigin(blocked), false);

  console.log('Admin origin checks passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
