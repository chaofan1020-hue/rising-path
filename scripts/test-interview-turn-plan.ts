import assert from 'node:assert/strict';
import { buildInterviewTurnPlanPrompt, createInterviewTurnPlan, signInterviewTurnPlan, verifyInterviewTurnPlan } from '../src/lib/interview-turn-plan';

const digest = {
  version: 1 as const,
  language: 'zh' as const,
  role: { company: 'Example', title: '数据分析师', direction: '增长', description: '', requirements: '', keywords: ['数据', '实验'] },
  company: { tagline: '', focusAreas: [{ dimension: '数据与分析', probes: ['请说明基线、指标与归因'] }], tone: '', vocabulary: [], cultureKeywords: [] },
  candidate: { baseline: '', skills: ['SQL'], evidence: [{ id: 'project-1', source: 'project' as const, label: '增长项目', content: '通过实验让激活率提升 8%', keywords: ['实验', '激活率'] }] },
};
const ledger = { version: 1 as const, coveredIntents: [], coveredDimensions: [], candidateClaims: [], openGaps: [], lastQuestion: '', lastAnswer: '' };
const plan = createInterviewTurnPlan({ digest, ledger, previousQuestion: '请讲一个你用数据归因的项目？', answer: '我做了一个实验，激活率提升了 8%。' });
const signed = signInterviewTurnPlan(plan, 'session-secret', 42, 1, '我做了一个实验，激活率提升了 8%。');
assert.deepEqual(verifyInterviewTurnPlan(signed.plan, signed.token, 'session-secret', 42, 1, '我做了一个实验，激活率提升了 8%。'), plan);
assert.equal(verifyInterviewTurnPlan(signed.plan, signed.token, 'wrong-secret', 42, 1, '我做了一个实验，激活率提升了 8%。'), null);
assert.ok(buildInterviewTurnPlanPrompt(plan, 'zh').includes('服务端已规划'));
console.log('interview turn plan checks passed');
