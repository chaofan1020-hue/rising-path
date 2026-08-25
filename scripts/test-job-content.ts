import assert from 'node:assert/strict';
import { jobHtmlToPlainText } from '@/lib/job-content';

assert.equal(jobHtmlToPlainText('FranÃ§ais'), 'Français');
assert.equal(jobHtmlToPlainText('æµ‹è¯•'), '测试');
assert.equal(jobHtmlToPlainText('<p>Requirements</p><ul><li>TypeScript</li></ul>'), 'Requirements\n\n• TypeScript');
console.log('job content tests passed');
