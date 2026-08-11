import assert from 'node:assert/strict';

import {
  AIProviderConfigError,
  createTextProviderClient,
  getAIProvider,
} from '../src/lib/ai/text-provider';

const environmentKeys = [
  'AI_PROVIDER',
  'DASHSCOPE_API_KEY',
] as const;

const originalEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]]),
);

function restoreEnvironment() {
  for (const key of environmentKeys) {
    const original = originalEnvironment[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
}

try {
  process.env.AI_PROVIDER = 'alibaba';
  delete process.env.DASHSCOPE_API_KEY;
  assert.equal(getAIProvider(), 'alibaba');
  assert.throws(
    () => createTextProviderClient(),
    (error: unknown) => error instanceof AIProviderConfigError
      && error.message.includes('DASHSCOPE_API_KEY'),
  );

  process.env.AI_PROVIDER = 'invalid';
  assert.throws(
    () => getAIProvider(),
    (error: unknown) => error instanceof AIProviderConfigError
      && error.message.includes('AI_PROVIDER'),
  );

  delete process.env.AI_PROVIDER;
  process.env.DASHSCOPE_API_KEY = 'test-key';
  assert.equal(getAIProvider(), 'alibaba');
} finally {
  restoreEnvironment();
}

console.log('AI provider configuration tests passed');
