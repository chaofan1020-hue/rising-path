import assert from 'node:assert/strict';
import {
  buildNetworkingContext,
  buildNetworkingPrompt,
  buildStageNetworkingPrompt,
  collectTargetCompanies,
  NETWORKING_STAGES,
} from '../src/lib/networking-recommender';
import type { ResumeProfile } from '../src/lib/resume-types';

function profile(): ResumeProfile {
  return {
    education: [{ school: 'University of Michigan', degree: 'Bachelor', major: 'Economics', endYear: 2028 }],
    internships: [],
    workExperience: [],
    projects: [],
    skills: [],
    certificates: [],
    intention: {
      roles: ['Data Analyst'],
      locations: ['United States'],
      industries: ['Tech'],
      targetCompanies: ['Microsoft'],
    },
  };
}

function testCollectTargetCompanies() {
  const result = collectTargetCompanies(
    ['Microsoft', 'Google'],
    ['Google', 'Amazon'],
    ['Microsoft'],
  );
  assert.deepEqual(result, ['Microsoft', 'Google', 'Amazon']);
}

function testBuildContext() {
  const context = buildNetworkingContext({
    profile: profile(),
    segmentation: null,
    region: 'us',
    favoriteCompanies: ['Google'],
    interviewCompanies: ['Meta'],
  });
  assert.equal(context.school, 'University of Michigan');
  assert.equal(context.role, 'Data Analyst');
  assert.deepEqual(context.targetCompanies, ['Microsoft', 'Google', 'Meta']);
}

function testBuildPrompt() {
  const context = buildNetworkingContext({
    profile: profile(),
    segmentation: null,
    region: 'us',
    favoriteCompanies: [],
    interviewCompanies: [],
  });
  const prompt = buildNetworkingPrompt(context, 'zh-CN');
  assert.ok(prompt.includes('Microsoft'));
  assert.ok(prompt.includes('简体中文'));
  assert.ok(prompt.includes('"stages"'));
  assert.equal(NETWORKING_STAGES.length, 5);
  const stagePrompt = buildStageNetworkingPrompt(context, 'en', 3);
  assert.ok(stagePrompt.includes('3'));
  assert.ok(stagePrompt.includes('peopleTypes'));
}

testCollectTargetCompanies();
testBuildContext();
testBuildPrompt();
console.log('networking recommender tests passed');
