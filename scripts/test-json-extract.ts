import assert from 'node:assert/strict';
import { extractFirstJsonObject } from '../src/lib/json-extract';

assert.deepEqual(
  extractFirstJsonObject('prefix {"message":"brace } in string","nested":{"ok":true}} suffix'),
  { message: 'brace } in string', nested: { ok: true } },
);
assert.deepEqual(extractFirstJsonObject('{"a":1} trailing {"b":2}'), { a: 1 });
assert.equal(extractFirstJsonObject('no json here'), null);
assert.equal(extractFirstJsonObject('{"incomplete": true'), null);
console.log('JSON extraction checks passed');
