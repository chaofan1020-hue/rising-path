import assert from 'node:assert/strict';
import {
  getEffectiveInterviewTTSProvider,
  resolveInterviewVoiceRoute,
} from '../src/lib/interview-voice-routing';

assert.equal(resolveInterviewVoiceRoute('United States').id, 'overseas_cartesia');
assert.equal(resolveInterviewVoiceRoute('North America').id, 'overseas_cartesia');
assert.equal(resolveInterviewVoiceRoute('New York').id, 'overseas_cartesia');
assert.equal(resolveInterviewVoiceRoute('英国 London').asrProvider, 'cartesia_ink');
assert.equal(resolveInterviewVoiceRoute('Singapore').ttsProvider, 'cartesia_sonic');
assert.equal(resolveInterviewVoiceRoute('中国北京').id, 'domestic_alibaba');
assert.equal(resolveInterviewVoiceRoute('cn_t1').asrProvider, 'alibaba');
assert.equal(resolveInterviewVoiceRoute('unknown-market').id, 'overseas_cartesia');

delete process.env.ALIBABA_TTS_ENABLED;
assert.deepEqual(getEffectiveInterviewTTSProvider(resolveInterviewVoiceRoute('中国')), {
  provider: 'cartesia_sonic',
  fallback: true,
  fallbackReason: 'alibaba_tts_not_enabled',
});

console.log('interview voice routing checks passed');
