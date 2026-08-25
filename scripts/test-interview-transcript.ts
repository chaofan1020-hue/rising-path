import assert from 'node:assert/strict';
import {
  isTranscriptLanguageUnexpected,
  mergeRecognizedTranscript,
} from '../src/lib/interview-transcript';

assert.equal(mergeRecognizedTranscript('', 'Hello world'), 'Hello world');
assert.equal(mergeRecognizedTranscript('Hello world', 'world from Liorvix'), 'Hello world from Liorvix');
assert.equal(mergeRecognizedTranscript('I led the project', 'led the project'), 'I led the project');
assert.equal(mergeRecognizedTranscript('我负责用户增长', '用户增长和数据分析'), '我负责用户增长和数据分析');
assert.equal(mergeRecognizedTranscript('First answer', 'Second answer'), 'First answer Second answer');

assert.equal(isTranscriptLanguageUnexpected('我负责用户增长和数据分析。', 'en'), true);
assert.equal(isTranscriptLanguageUnexpected('I led growth experiments and analyzed retention.', 'zh'), true);
assert.equal(isTranscriptLanguageUnexpected('I used SQL 和 Python 做分析。', 'zh'), false);
assert.equal(isTranscriptLanguageUnexpected('I used SQL and Python for analysis.', 'en'), false);

console.log('interview transcript checks passed');
