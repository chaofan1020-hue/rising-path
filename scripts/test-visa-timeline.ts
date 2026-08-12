import assert from 'node:assert/strict';
import { buildVisaTimeline } from '../src/lib/visa-timeline';

function testUSF1NoOpt() {
  const timeline = buildVisaTimeline({
    region: 'us',
    visaStatus: 'us_f1_no_opt',
    programEndYear: 2026,
  });
  assert.ok(timeline.entries.some((entry) => entry.key === 'opt_application_window'));
  assert.ok(timeline.entries.some((entry) => entry.key === 'h1b_lottery'));
}

function testUKPSW() {
  const timeline = buildVisaTimeline({
    region: 'uk',
    visaStatus: 'uk_psw',
    visaDates: { visaEndDate: '2028-08-01' },
  });
  assert.ok(timeline.entries.some((entry) => entry.key === 'visa_expiry'));
}

function testCanadaPGWP() {
  const timeline = buildVisaTimeline({
    region: 'ca',
    visaStatus: 'ca_study_permit',
    programEndYear: 2026,
  });
  assert.ok(timeline.entries.some((entry) => entry.key === 'pgwp_application'));
}

function testHongKongIANG() {
  const timeline = buildVisaTimeline({
    region: 'hk',
    visaStatus: 'hk_student_visa',
    programEndYear: 2026,
  });
  assert.ok(timeline.entries.some((entry) => entry.key === 'iang_application'));
}

function testAustralia485() {
  const timeline = buildVisaTimeline({
    region: 'au',
    visaStatus: 'au_student_visa',
    programEndYear: 2026,
  });
  assert.ok(timeline.entries.some((entry) => entry.key === 'visa485_application'));
}

function testUnknown() {
  const timeline = buildVisaTimeline({
    region: 'us',
    visaStatus: undefined,
  });
  assert.ok(timeline.entries.some((entry) => entry.key === 'confirm_status'));
}

testUSF1NoOpt();
testUKPSW();
testCanadaPGWP();
testHongKongIANG();
testAustralia485();
testUnknown();
console.log('visa timeline tests passed');
