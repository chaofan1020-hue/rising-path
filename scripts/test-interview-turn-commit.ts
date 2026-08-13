import assert from 'node:assert/strict';
import { getAppendedInterviewTurns } from '../src/lib/interview-turn-commit';

const transcript = [
  { role: 'interviewer' as const, content: '请介绍一次你主导的数据分析。', round: 1 },
  { role: 'candidate' as const, content: '我负责了实验设计与归因。', round: 1 },
  { role: 'interviewer' as const, content: '你如何排除季节性因素？', round: 1 },
];

const turns = getAppendedInterviewTurns(transcript, 1);
assert.deepEqual(turns.map((turn) => turn.turnIndex), [1, 2]);
assert.deepEqual(turns.map((turn) => turn.message.role), ['candidate', 'interviewer']);
assert.throws(() => getAppendedInterviewTurns(transcript, 4), /invalid persisted/);

console.log('interview turn commit checks passed');
