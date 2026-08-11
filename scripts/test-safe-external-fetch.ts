import assert from 'node:assert/strict';
import { isForbiddenExternalAddress } from '../src/lib/safe-external-fetch';

for (const address of [
  '127.0.0.1',
  '10.0.0.1',
  '169.254.169.254',
  '172.16.0.1',
  '192.168.1.1',
  '::1',
  'fc00::1',
  'fe80::1',
  '::ffff:127.0.0.1',
]) {
  assert.equal(isForbiddenExternalAddress(address), true, `${address} must be blocked`);
}

assert.equal(isForbiddenExternalAddress('8.8.8.8'), false);
assert.equal(isForbiddenExternalAddress('2606:4700:4700::1111'), false);
console.log('safe external fetch address checks passed');
