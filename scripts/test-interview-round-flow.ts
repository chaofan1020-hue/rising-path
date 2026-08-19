import assert from 'node:assert/strict';
import { buildInterviewRoundClosing, decideInterviewTurnAction } from '../src/lib/interview-round-flow';

assert.equal(decideInterviewTurnAction({ isTimeout: false, isLastRound: false, answersThisRound: 1, questionQuota: 2 }), 'continue');
assert.equal(decideInterviewTurnAction({ isTimeout: false, isLastRound: false, answersThisRound: 2, questionQuota: 2 }), 'round_end');
assert.equal(decideInterviewTurnAction({ isTimeout: false, isLastRound: true, answersThisRound: 2, questionQuota: 2 }), 'session_complete');
assert.equal(decideInterviewTurnAction({ isTimeout: true, isLastRound: false, answersThisRound: 0, questionQuota: 2 }), 'round_end');

const zhRoundClosing = buildInterviewRoundClosing({ language: 'zh', action: 'round_end', timedOut: false });
const enFinalClosing = buildInterviewRoundClosing({ language: 'en', action: 'session_complete', timedOut: false });
assert.equal(/[？?]/.test(zhRoundClosing), false);
assert.equal(/[？?]/.test(enFinalClosing), false);
assert.match(zhRoundClosing, /下一位面试官/);
assert.match(enFinalClosing, /concludes/);

console.log('interview round flow checks passed');
