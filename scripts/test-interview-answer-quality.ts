import assert from 'node:assert/strict';
import { classifyInterviewAnswerQuality, shouldEndInterviewEarly } from '../src/lib/interview-answer-quality';

assert.equal(classifyInterviewAnswerQuality('嗯，不知道。'), 'severely_poor');
assert.equal(classifyInterviewAnswerQuality('I do not know.'), 'severely_poor');
assert.equal(classifyInterviewAnswerQuality('没。'), 'substantive');
assert.equal(classifyInterviewAnswerQuality('我负责了一个增长实验，先定义指标，再通过两轮 A/B 测试验证，最终让激活率提升了 8%。'), 'substantive');
assert.equal(shouldEndInterviewEarly({ answer: '我不知道。', previousAnswers: ['不清楚。', '没做过。'], answersThisRound: 3 }), true);
assert.equal(shouldEndInterviewEarly({ answer: '我做了一个项目，负责数据分析并推动上线，最后指标提升了 10%。', previousAnswers: ['不清楚。', '没做过。'], answersThisRound: 3 }), false);
assert.equal(shouldEndInterviewEarly({ answer: '不知道。', previousAnswers: ['不清楚。'], answersThisRound: 2 }), false);

console.log('interview answer quality checks passed');
