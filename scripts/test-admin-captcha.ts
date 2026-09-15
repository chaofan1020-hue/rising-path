import assert from 'node:assert/strict';
import { createAdminCaptchaChallenge, verifyAdminCaptchaSolution } from '@/lib/admin-captcha';
import { ADMIN_CAPTCHA_DIFFICULTY, solveAdminCaptcha } from '@/lib/admin-captcha-core';

process.env.ADMIN_SESSION_SECRET = 'admin-captcha-test-secret';

async function main() {
  const challenge = await createAdminCaptchaChallenge();
  assert.equal(challenge.difficulty, ADMIN_CAPTCHA_DIFFICULTY);
  const solution = await solveAdminCaptcha(challenge);
  assert.equal(await verifyAdminCaptchaSolution(solution), true);
  assert.equal(await verifyAdminCaptchaSolution(solution), false);
  assert.equal(await verifyAdminCaptchaSolution({ ...solution, nonce: `${solution.nonce}ab` }), false);
  assert.equal(await verifyAdminCaptchaSolution({ ...challenge, counter: solution.counter + 1 }), false);
  assert.equal(await verifyAdminCaptchaSolution(null), false);
  console.log('Admin captcha checks passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
