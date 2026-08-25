import { strict as assert } from 'node:assert';
import { isBetaAccessEnforced, isBetaRealtimeVoiceEnabled, metricForAiFeature } from '@/lib/beta-entitlements';

const originalValue = process.env.BETA_ACCESS_ENFORCED;
const originalRealtimeValue = process.env.BETA_REALTIME_VOICE_ENABLED;

try {
  process.env.BETA_ACCESS_ENFORCED = 'false';
  assert.equal(isBetaAccessEnforced(), false);
  process.env.BETA_ACCESS_ENFORCED = 'TRUE';
  assert.equal(isBetaAccessEnforced(), true);
  process.env.BETA_REALTIME_VOICE_ENABLED = 'false';
  assert.equal(isBetaRealtimeVoiceEnabled(), false);
  process.env.BETA_REALTIME_VOICE_ENABLED = 'true';
  assert.equal(isBetaRealtimeVoiceEnabled(), true);
  assert.equal(metricForAiFeature('ai_match'), 'ai_match');
  assert.equal(metricForAiFeature('resume_optimize'), 'resume_optimize');
  assert.equal(metricForAiFeature('resume_score'), 'resume_score');
  assert.equal(metricForAiFeature('interview_chat'), 'interview_turn');
  assert.equal(metricForAiFeature('interview_summary'), 'interview_turn');
  assert.equal(metricForAiFeature('resume_profile_extraction'), 'resume_parse');
  assert.equal(metricForAiFeature('resume_profile'), 'resume_parse');
  assert.equal(metricForAiFeature('unlisted_feature'), 'ai_text');
  console.log('beta entitlement mapping tests passed');
} finally {
  if (originalValue === undefined) delete process.env.BETA_ACCESS_ENFORCED;
  else process.env.BETA_ACCESS_ENFORCED = originalValue;
  if (originalRealtimeValue === undefined) delete process.env.BETA_REALTIME_VOICE_ENABLED;
  else process.env.BETA_REALTIME_VOICE_ENABLED = originalRealtimeValue;
}
