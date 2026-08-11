import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  hashAdminPassword,
  verifyAdminPasswordHash,
} from '../src/lib/admin-password';

const password = 'a-secure-admin-password';

async function main() {
  const hash = await hashAdminPassword(password);

  assert.match(hash, /^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/);
  assert.deepEqual(await verifyAdminPasswordHash(password, hash), {
    valid: true,
    needsRehash: false,
  });
  assert.equal((await verifyAdminPasswordHash('wrong-password', hash)).valid, false);
  assert.equal((await verifyAdminPasswordHash(password, 'not-a-valid-hash')).valid, false);

  const legacyHash = crypto
    .createHash('sha256')
    .update(password + 'risingpath_salt')
    .digest('hex');
  assert.deepEqual(await verifyAdminPasswordHash(password, legacyHash), {
    valid: true,
    needsRehash: true,
  });

  console.log('admin password hashing checks passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
