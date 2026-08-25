import assert from 'node:assert/strict';
import { downsampleToPCM16 } from '../src/lib/interview-asr-client';

const decode = (buffer: ArrayBuffer) => new Int16Array(buffer);

assert.equal(downsampleToPCM16(new Float32Array(160), 16_000).byteLength, 320);
assert.equal(downsampleToPCM16(new Float32Array(80), 8_000).byteLength, 320);
assert.equal(downsampleToPCM16(new Float32Array(480), 48_000).byteLength, 320);

const upsampled = decode(downsampleToPCM16(Float32Array.from([0, 1]), 8_000));
assert.equal(upsampled.length, 4);
assert.ok(upsampled[1] > 0 && upsampled[1] < 32_767);
assert.equal(decode(downsampleToPCM16(new Float32Array(), 48_000)).length, 0);

console.log('interview ASR client checks passed');
