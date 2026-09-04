import assert from 'node:assert/strict';
import { buildWorkdayCxsDetailUrl, isForbiddenExternalAddress } from '../src/lib/safe-external-fetch';

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

assert.equal(
  buildWorkdayCxsDetailUrl('https://vanguard.wd5.myworkdayjobs.com/vanguard_external/job/Malvern-PA/example_181766/apply'),
  'https://vanguard.wd5.myworkdayjobs.com/wday/cxs/vanguard/vanguard_external/job/Malvern-PA/example_181766',
);
assert.equal(
  buildWorkdayCxsDetailUrl('https://citi.wd5.myworkdayjobs.com/en-US/2/job/Houston-Texas/example_25926650'),
  'https://citi.wd5.myworkdayjobs.com/wday/cxs/citi/2/job/Houston-Texas/example_25926650',
);
console.log('safe external fetch address checks passed');
