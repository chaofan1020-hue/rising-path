import assert from 'node:assert/strict';
import { CappedMap, createChallenge, randomInt, solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import { deriveHmacKeySecret, verify } from 'altcha-lib/frameworks/shared';
import { createAltchaChallenge, isCaptchaEnabled, readCaptchaToken, verifyAltchaPayload } from '@/lib/altcha';

assert.equal(readCaptchaToken({ captchaToken: 'abc' }), 'abc');
assert.equal(readCaptchaToken({ altcha: 'from-widget' }), 'from-widget');
assert.equal(readCaptchaToken({ turnstileToken: 'legacy' }), 'legacy');
assert.equal(isCaptchaEnabled(), process.env.AUTH_CAPTCHA !== 'off');

async function main() {
  const hmacSignatureSecret = 'liorvix-altcha-test-secret-key';
  const hmacKeySignatureSecret = await deriveHmacKeySecret(hmacSignatureSecret);
  const store = new CappedMap<string, boolean>({ maxSize: 16 });

  const challenge = await createChallenge({
    algorithm: 'PBKDF2/SHA-256',
    cost: 1_000,
    counter: randomInt(2_000, 1_000),
    deriveKey,
    expiresAt: new Date(Date.now() + 60_000),
    hmacKeySignatureSecret,
    hmacSignatureSecret,
  });

  const solution = await solveChallenge({
    challenge,
    deriveKey,
  });
  assert.ok(solution, 'expected a solution for the ALTCHA challenge');

  const payload = Buffer.from(JSON.stringify({ challenge, solution }), 'utf8').toString('base64');
  const first = await verify(payload, deriveKey, hmacSignatureSecret, hmacKeySignatureSecret, store);
  assert.equal(first.verification?.verified, true);
  assert.equal(first.error, null);

  const replay = await verify(payload, deriveKey, hmacSignatureSecret, hmacKeySignatureSecret, store);
  assert.notEqual(replay.error, null);
  assert.notEqual(replay.verification?.verified, true);

  const invalid = await verify('not-a-payload', deriveKey, hmacSignatureSecret, hmacKeySignatureSecret, store);
  assert.equal(invalid.verification?.verified, undefined);
  assert.notEqual(invalid.error, null);

  const appChallenge = await createAltchaChallenge();
  const appSolution = await solveChallenge({ challenge: appChallenge, deriveKey });
  assert.ok(appSolution, 'expected a solution for the app ALTCHA challenge');
  const appPayload = Buffer.from(JSON.stringify({ challenge: appChallenge, solution: appSolution }), 'utf8').toString('base64');
  assert.equal(await verifyAltchaPayload(appPayload), true);
  assert.equal(await verifyAltchaPayload(appPayload), false);
  assert.equal(await verifyAltchaPayload('short'), false);

  console.log('ALTCHA checks passed');
}

void main();
