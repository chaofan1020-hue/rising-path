import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { isCreditsEnforced, metricForFeature, SIGNUP_WELCOME_CREDITS } from '@/lib/credits';
import { creditCostFromRules, formatCreditCost, mapCreditPriceRows } from '@/lib/credit-prices';

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

  const welcomeMigration = fs.readFileSync(path.join(process.cwd(), 'supabase', 'migrations', '0128_signup_welcome_credits.sql'), 'utf8');
  assert.match(welcomeMigration, /grant_amount numeric := 300/);
  assert.match(welcomeMigration, /signup_welcome:' \|\| p_user_id::text/);
  assert.match(welcomeMigration, /perform public\.grant_signup_welcome_credits\(new\.id\)/);
  assert.match(welcomeMigration, /perform public\.grant_signup_welcome_credits\(rec\.id\)/);
  assert.equal(SIGNUP_WELCOME_CREDITS, 300);
  assert.equal(formatCreditCost(8), '8');
  assert.equal(formatCreditCost(8.5), '8.5');
  assert.equal(creditCostFromRules([{ metric: 'ai_match', creditCost: 3 }], 'ai_match', 8), 3);
  assert.equal(creditCostFromRules([], 'ai_match', 8), 8);
  const mapped = mapCreditPriceRows([{ metric: 'ai_match', display_name: 'AI 选岗', unit_name: '次', credit_cost: '5.00', max_units_per_request: 1, notes: null }]);
  assert.equal(mapped[0]?.creditCost, 5);
  const pricesRoute = fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'api', 'credits', 'prices', 'route.ts'), 'utf8');
  assert.match(pricesRoute, /credit_price_rules/);
  assert.match(pricesRoute, /no-store/);
  console.log('credit mapping tests passed');
} finally {
  if (originalCredits === undefined) delete process.env.CREDITS_ENFORCED;
  else process.env.CREDITS_ENFORCED = originalCredits;
  if (originalBeta === undefined) delete process.env.BETA_ACCESS_ENFORCED;
  else process.env.BETA_ACCESS_ENFORCED = originalBeta;
}
