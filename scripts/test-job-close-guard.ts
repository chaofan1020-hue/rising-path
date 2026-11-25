import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { allowsLinkClose, shouldCloseAfterLinkFailure } from '../src/lib/job-link-health';

/**
 * A link check must never own the lifecycle on its own.
 *
 * 2026-11-25: the link-health worker closed 1,914 legacy collector rows after
 * 404/410 responses. Checking every one against the upstream database showed
 * 25 that upstream still listed as OPEN (LinkedIn/Deloitte seed 404s, BCG/Bosch
 * 410s). Those closes were reverted and this gate was added: the link signal
 * alone is never enough, upstream has to agree the record is gone.
 */
assert.equal(allowsLinkClose(false, 'absent'), false, 'no link signal -> no close');
assert.equal(allowsLinkClose(false, 'open'), false);
assert.equal(allowsLinkClose(false, 'unknown'), false);
assert.equal(allowsLinkClose(true, 'open'), false, 'upstream still OPEN must veto the close');
assert.equal(allowsLinkClose(true, 'unknown'), false, 'unverifiable upstream must not close');
assert.equal(allowsLinkClose(true, 'absent'), true, 'upstream no longer lists it -> close is consistent');

/** The gate is only meaningful if the worker actually calls it. */
const maintenance = fs.readFileSync(path.join(process.cwd(), 'src/lib/job-maintenance.ts'), 'utf8');
assert.match(maintenance, /allowsLinkClose\(shouldClose, verdict\)/);
assert.match(maintenance, /fetchJobForSyncRetry\(/);
assert.match(maintenance, /if \(allowedToClose\) \{/);
assert.ok(
  !/if \(shouldClose\) \{\s*const \{ error: closeError \}/.test(maintenance),
  'the raw shouldClose flag must not gate the jobs update',
);

/** A 404 still needs two observations; a 410 closes immediately. */
assert.equal(shouldCloseAfterLinkFailure({ httpStatus: 404, previousFailures: 0 }), false);
assert.equal(shouldCloseAfterLinkFailure({ httpStatus: 404, previousFailures: 1 }), true);
assert.equal(shouldCloseAfterLinkFailure({ httpStatus: 410 }), true);
assert.equal(shouldCloseAfterLinkFailure({ httpStatus: 200 }), false);
assert.equal(shouldCloseAfterLinkFailure({ httpStatus: null, explicitClosed: true }), true);

console.log('job close guard tests passed');
