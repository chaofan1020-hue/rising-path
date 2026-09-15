import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeDashboardReadiness,
  nextStaleResumeProcessingAction,
} from '../src/lib/dashboard-readiness';
import { isActiveResumeProcessing } from '../src/lib/resume-types';
import {
  classifyResumeAvailability,
  pickEligibleResumeId,
} from '../src/lib/resume-availability';

function testProcessingHelpers() {
  assert.equal(isActiveResumeProcessing('uploaded'), true);
  assert.equal(isActiveResumeProcessing('extracting_profile'), true);
  assert.equal(isActiveResumeProcessing('needs_confirmation'), false);
  assert.equal(isActiveResumeProcessing('ready'), false);
  assert.equal(isActiveResumeProcessing('failed'), false);
  assert.equal(nextStaleResumeProcessingAction(1), 'requeue');
  assert.equal(nextStaleResumeProcessingAction(3), 'fail');
}

function testDashboardStaysQuietUntilParseFinishes() {
  const processing = computeDashboardReadiness({
    hasResume: true,
    processingStatus: 'extracting_profile',
    segmentationConfirmed: false,
    hasRegion: false,
    hasRoles: false,
    identityMissing: false,
  });
  assert.equal(processing.processing, true);
  assert.equal(processing.planReady, false);
  assert.equal(processing.profileReady, false);
  assert.ok(processing.missingSteps.includes('processing'));
}

function testConfirmedRegionUnlocksCockpitWithoutVisa() {
  const ready = computeDashboardReadiness({
    hasResume: true,
    processingStatus: 'ready',
    segmentationConfirmed: true,
    hasRegion: true,
    hasRoles: false,
    identityMissing: true,
  });
  assert.equal(ready.planReady, true);
  assert.equal(ready.profileReady, false);
  assert.deepEqual(ready.missingSteps, ['role', 'identity']);
}

function testCompleteProfileIsFullyReady() {
  const ready = computeDashboardReadiness({
    hasResume: true,
    processingStatus: 'ready',
    segmentationConfirmed: true,
    hasRegion: true,
    hasRoles: true,
    identityMissing: false,
  });
  assert.equal(ready.planReady, true);
  assert.equal(ready.profileReady, true);
  assert.deepEqual(ready.missingSteps, []);
}

function testResumeAvailabilityDistinguishesProcessingFromConfirm() {
  const processing = classifyResumeAvailability([
    { id: 1, processing_status: 'extracting_profile', segmentation_confirmed: false },
  ]);
  assert.equal(processing.status, 'processing');
  assert.equal(processing.eligible.length, 0);

  const confirm = classifyResumeAvailability([
    { id: 2, processing_status: 'needs_confirmation', segmentation_confirmed: false },
  ]);
  assert.equal(confirm.status, 'confirm');
  assert.equal(confirm.pendingConfirm.length, 1);

  const failed = classifyResumeAvailability([
    { id: 3, processing_status: 'failed', segmentation_confirmed: false },
  ]);
  assert.equal(failed.status, 'failed');

  const ready = classifyResumeAvailability([
    { id: 4, processing_status: 'ready', segmentation_confirmed: true },
    { id: 5, processing_status: 'extracting_text', segmentation_confirmed: false },
  ]);
  assert.equal(ready.status, 'ready');
  assert.deepEqual(ready.eligible.map((item) => item.id), [4]);
}

function testPickEligibleResumeIgnoresUnconfirmedActiveId() {
  const eligible = [{ id: 8 }, { id: 9 }];
  assert.equal(pickEligibleResumeId(eligible, 8), 8);
  assert.equal(pickEligibleResumeId(eligible, 12), 8);
  assert.equal(pickEligibleResumeId([], 8), null);
}

function testCoreFlowSurfacesResumeStatusInsteadOfEmptySilence() {
  const resumePage = readFileSync(join(process.cwd(), 'src/app/resume/page.tsx'), 'utf8');
  assert.match(resumePage, /waitingConfirmHint/);
  assert.match(resumePage, /resumeAvailability\.status === 'confirm'/);
  assert.match(resumePage, /isProcessing\(resume\)/);
  assert.doesNotMatch(
    resumePage,
    /hasConfirmedResume \? t\('resume\.uploaded'\) : t\('resume\.parsing'\)/,
    'resume banner must not label unconfirmed resumes as still parsing',
  );

  const matchPage = readFileSync(join(process.cwd(), 'src/app/ai-match/page.tsx'), 'utf8');
  assert.match(matchPage, /useResumeAvailability/);
  assert.match(matchPage, /pickEligibleResumeId/);
  assert.match(matchPage, /ResumeAvailabilityHint/);

  const optimizePage = readFileSync(join(process.cwd(), 'src/app/optimize/page.tsx'), 'utf8');
  assert.match(optimizePage, /ResumeAvailabilityHint/);
  assert.match(optimizePage, /useResumeAvailability/);

  const interviewPage = readFileSync(join(process.cwd(), 'src/app/mock-interview/page.tsx'), 'utf8');
  assert.match(interviewPage, /ResumeAvailabilityHint/);
  assert.match(interviewPage, /useResumeAvailability/);
}

function testParseDoesNotBlockOnCareerPlan() {
  const source = readFileSync(join(process.cwd(), 'src/lib/resume-processing.ts'), 'utf8');
  assert.match(source, /processing_status: 'needs_confirmation'/);
  const confirmationIndex = source.indexOf("processing_status: 'needs_confirmation'");
  const refineIndex = source.indexOf('void refineCareerPlan(');
  assert.ok(refineIndex > confirmationIndex, 'career plan refinement must run after the resume is ready to confirm');
  assert.doesNotMatch(
    source.slice(0, confirmationIndex),
    /await refineCareerPlan\(/,
    'initial parse must not wait for cockpit copy before needs_confirmation',
  );
}

async function main() {
  testProcessingHelpers();
  testDashboardStaysQuietUntilParseFinishes();
  testConfirmedRegionUnlocksCockpitWithoutVisa();
  testCompleteProfileIsFullyReady();
  testParseDoesNotBlockOnCareerPlan();
  testResumeAvailabilityDistinguishesProcessingFromConfirm();
  testPickEligibleResumeIgnoresUnconfirmedActiveId();
  testCoreFlowSurfacesResumeStatusInsteadOfEmptySilence();
  console.log('cockpit flow regression tests passed');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
