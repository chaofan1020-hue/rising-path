import assert from 'node:assert/strict';
import { interviewChatRequestSchema } from '../src/lib/interview-chat-validation';

const valid = interviewChatRequestSchema.parse({
  jobDescription: 'Data analyst role',
  resumeId: 1,
  mode: 'gauntlet',
  totalRounds: 4,
  targetCompany: 'IBM',
});
assert.equal(valid.language, 'zh');
assert.equal(valid.practiceMode, 'fresh');
assert.equal(valid.totalRounds, 4);
assert.equal(valid.inputSource, 'system');

assert.equal(interviewChatRequestSchema.safeParse({ totalRounds: 5 }).success, false);
assert.equal(interviewChatRequestSchema.safeParse({ answer: 'x'.repeat(10_001) }).success, false);
assert.equal(interviewChatRequestSchema.safeParse({ mode: 'invalid' }).success, false);
assert.equal(interviewChatRequestSchema.safeParse({ inputSource: 'text' }).success, false);
assert.equal(interviewChatRequestSchema.safeParse({ unexpected: true }).success, false);

console.log('interview chat validation checks passed');
