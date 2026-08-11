import assert from 'node:assert/strict';
import { getTTSProvider, TTSProviderConfigError } from '../src/lib/tts-provider';

process.env.TTS_PROVIDER = 'cartesia';
process.env.CARTESIA_API_KEY = 'test-key';
process.env.CARTESIA_VOICE_ZH = 'zh-voice-id';
process.env.CARTESIA_VOICE_EN = 'en-voice-id';

assert.equal(getTTSProvider(), 'cartesia');

process.env.TTS_PROVIDER = 'invalid';
assert.throws(() => getTTSProvider(), TTSProviderConfigError);

delete process.env.TTS_PROVIDER;
assert.equal(getTTSProvider(), 'cartesia');

console.log('TTS provider configuration tests passed');
