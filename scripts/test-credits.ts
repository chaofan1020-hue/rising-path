import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { isCreditsEnforced, metricForFeature } from '@/lib/credits';

const originalCredits = process.env.CREDITS_ENFORCED;
const originalBeta = process.env.BETA_ACCESS_ENFORCED;

try {
  process.env.CREDITS_ENFORCED = 'false';
  process.env.BETA_ACCESS_ENFORCED = 'false';
  assert.equal(isCreditsEnforced(), false);
  process.env.CREDITS_ENFORCED = 'true';
  assert.equal(isCreditsEnforced(), true);
  process.env.CREDITS_ENFORCED = 'false';
  process.env.BETA_ACCESS_ENFORCED = 'true';
  assert.equal(isCreditsEnforced(), false);
  assert.equal(metricForFeature('ai_match'), 'ai_match');
  assert.equal(metricForFeature('resume_profile_extraction'), 'resume_parse');
  assert.equal(metricForFeature('interview_chat'), 'interview_turn');
  assert.equal(metricForFeature('interview_asr'), 'asr_minutes');
  assert.equal(metricForFeature('interview_tts'), 'tts_minutes');
  assert.equal(metricForFeature('application_profile'), 'application_profile');
  assert.equal(metricForFeature('application_prefill'), 'application_prefill');
  assert.equal(metricForFeature('unknown'), 'ai_text');

  const grantFunction = fs.readFileSync(path.join(process.cwd(), 'supabase', 'migrations', '0065_fix_grant_credits_ambiguity.sql'), 'utf8');
  assert.match(grantFunction, /update public\.credit_accounts as credit_account/i);
  assert.doesNotMatch(grantFunction, /set balance = balance \+ p_amount/i);
  console.log('credit mapping tests passed');
} finally {
  if (originalCredits === undefined) delete process.env.CREDITS_ENFORCED;
  else process.env.CREDITS_ENFORCED = originalCredits;
  if (originalBeta === undefined) delete process.env.BETA_ACCESS_ENFORCED;
  else process.env.BETA_ACCESS_ENFORCED = originalBeta;
}
