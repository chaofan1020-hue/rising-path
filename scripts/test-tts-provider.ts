import assert from 'node:assert/strict';
import {
  createTTSProviderClient,
  getTTSProvider,
  TTSProviderConfigError,
} from '../src/lib/tts-provider';

process.env.TTS_PROVIDER = 'cartesia';
process.env.CARTESIA_API_KEY = 'test-key';
process.env.CARTESIA_VOICE_ZH = 'zh-voice-id';
process.env.CARTESIA_VOICE_EN = 'en-voice-id';

assert.equal(getTTSProvider(), 'cartesia');

process.env.TTS_PROVIDER = 'invalid';
assert.throws(() => getTTSProvider(), TTSProviderConfigError);

delete process.env.TTS_PROVIDER;
assert.equal(getTTSProvider(), 'cartesia');

async function testCartesiaOutputFormat() {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        output_format?: { container?: string; bit_rate?: number; sample_rate?: number };
      };
      assert.equal(body.output_format?.container, 'mp3');
      assert.equal(body.output_format?.bit_rate, 128000);
      assert.equal(body.output_format?.sample_rate, 44100);
      return new Response('', {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      });
    };

    const result = await createTTSProviderClient().synthesize({
      text: 'hello',
      language: 'en',
    });
    assert.equal(result.provider, 'cartesia');
    assert.equal(result.contentType, 'audio/mpeg');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void testCartesiaOutputFormat().then(() => {
  console.log('TTS provider configuration tests passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
