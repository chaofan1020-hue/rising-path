import assert from 'node:assert/strict';
import { recognizeWithAlibaba } from '../src/lib/asr-provider';

async function main() {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.DASHSCOPE_API_KEY;
  const originalBaseUrl = process.env.ALIBABA_ASR_BASE_URL;
  const originalModel = process.env.ALIBABA_ASR_MODEL;

  try {
    process.env.DASHSCOPE_API_KEY = 'test-key';
    process.env.ALIBABA_ASR_BASE_URL = 'https://dashscope.example.test/compatible-mode/v1';
    process.env.ALIBABA_ASR_MODEL = 'qwen3-asr-flash';

    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), 'https://dashscope.example.test/compatible-mode/v1/chat/completions');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-key');
      const payload = JSON.parse(String(init?.body)) as {
        model: string;
        messages: Array<{ content: Array<{ input_audio?: { data?: string } }> }>;
      };
      assert.equal(payload.model, 'qwen3-asr-flash');
      assert.equal(payload.messages[0]?.content[0]?.input_audio?.data, 'data:audio/webm;base64,AQID');
      return new Response(JSON.stringify({
        choices: [{ message: { content: ' 你好，Rising Path。' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const result = await recognizeWithAlibaba({ audioBase64: 'AQID' });
    assert.equal(result.text, '你好，Rising Path。');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.ALIBABA_ASR_BASE_URL;
    else process.env.ALIBABA_ASR_BASE_URL = originalBaseUrl;
    if (originalModel === undefined) delete process.env.ALIBABA_ASR_MODEL;
    else process.env.ALIBABA_ASR_MODEL = originalModel;
  }
}

void main().then(() => {
  console.log('Alibaba ASR provider tests passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
