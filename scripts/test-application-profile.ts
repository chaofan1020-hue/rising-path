import assert from 'node:assert/strict';
import {
  buildProfileFromResume,
  DEFAULT_PROFILE,
  mergeApplicationProfile,
  normalizeAiProfile,
} from '../src/lib/application-profile';
import type { ResumeUserInfo } from '../src/lib/resume-parser';
import type { ResumeProfile } from '../src/lib/resume-types';

const userInfo: ResumeUserInfo = {
  name: 'Alex Yuming Zhang',
  email: 'alex@example.com',
  skills: ['Python', 'SQL'],
};

const profile: ResumeProfile = {
  education: [],
  internships: [],
  workExperience: [],
  projects: [],
  skills: ['Python', 'SQL'],
  certificates: [],
  languages: ['English'],
  intention: {
    roles: ['Data Analyst'],
    workAuthorization: 'OPT',
    visaStatus: 'student',
  },
};

function testBuildProfileFromResume() {
  const built = buildProfileFromResume(userInfo, profile);
  assert.equal(built.profile.personal.firstName, 'Alex Yuming');
  assert.equal(built.profile.personal.lastName, 'Zhang');
  assert.equal(built.profile.personal.email, 'alex@example.com');
  assert.deepEqual(built.profile.skills, ['Python', 'SQL']);
  assert.equal(built.profile.workAuthorization, 'OPT');
  assert.equal(built.profile.visaStatus, 'student');
}

function testNormalizeAiProfile() {
  const built = buildProfileFromResume(userInfo, profile);
  const ai = normalizeAiProfile({
    personal: { firstName: 'AI First' },
    education: [{ raw: 'NYU | Master | Economics | 2024-2026' }],
    experience: [{ raw: 'Microsoft | Strategy Intern | 2025' }],
    skills: ['SQL'],
    languages: ['Chinese'],
    workAuthorization: 'H1B',
    summary: 'AI summary',
  }, built.profile);
  assert.equal(ai.personal.firstName, 'AI First');
  assert.equal(ai.personal.email, 'alex@example.com');
  assert.deepEqual(ai.education, [{ raw: 'NYU | Master | Economics | 2024-2026' }]);
  assert.deepEqual(ai.experience, [{ raw: 'Microsoft | Strategy Intern | 2025' }]);
  assert.deepEqual(ai.skills, ['SQL']);
  assert.equal(ai.workAuthorization, 'H1B');
  assert.equal(ai.summary, 'AI summary');
}

function testMergeEducationAndExperience() {
  const merged = mergeApplicationProfile(
    DEFAULT_PROFILE,
    {
      education: [{ raw: 'NYU | Master' }],
      experience: [{ raw: 'Microsoft | Intern' }],
    },
    {},
  );
  assert.deepEqual(merged.profile.education, [{ raw: 'NYU | Master' }]);
  assert.deepEqual(merged.profile.experience, [{ raw: 'Microsoft | Intern' }]);
  assert.equal(merged.source.education?.source, 'manual');
  assert.equal(merged.source.experience?.source, 'manual');
}

testBuildProfileFromResume();
testNormalizeAiProfile();
testMergeEducationAndExperience();
console.log('application profile tests passed');
