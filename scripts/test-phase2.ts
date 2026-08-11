import assert from 'node:assert/strict';

function createResumeClient(row: Record<string, unknown>) {
  const query = {
    select() {
      return query;
    },
    eq() {
      return query;
    },
    async single() {
      return { data: row, error: null };
    },
  };

  return {
    from() {
      return query;
    },
  };
}

async function testResumeSegmentation() {
  const {
    deriveCareerStage,
    deriveExperienceQuality,
    deriveRegions,
  } = await import('../src/lib/user-segmentation');

  const profile = {
    education: [{ school: 'National University of Singapore', degree: 'Master', endYear: 2026 }],
    internships: [{
      company: 'Acme',
      role: 'Data Analyst Intern',
      months: 6,
      highlights: ['Improved conversion by 28% and served 12k users'],
    }],
    workExperience: [],
    projects: [{ name: 'Forecasting', outcomes: ['Reduced processing time by 40%'] }],
    skills: ['SQL', 'Python'],
    certificates: [],
    languages: ['IELTS 7.5'],
    meta: { resumeLanguage: 'en' as const, pages: 1 },
    intention: { locations: ['Singapore'], roles: ['Data Analyst'] },
  };

  assert.equal(deriveCareerStage(profile, new Date('2026-01-01')).stage, 'senior');
  assert.deepEqual(deriveRegions(profile), { regions: ['sg'], source: 'intention' });
  assert.equal(deriveExperienceQuality(profile).quantifiedDensity, 'high');
}

async function testMissingResumeAiConfigurationFailsFast() {
  delete process.env.DASHSCOPE_API_KEY;
  delete process.env.AI_PROVIDER;
  delete process.env.RESUME_PROFILE_LLM_TIMEOUT_MS;

  const { parseResumeText } = await import('../src/lib/resume-parser');
  const startedAt = Date.now();

  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    await assert.rejects(
      parseResumeText('Candidate resume content', 1),
      (error: unknown) => error instanceof Error
        && error.name === 'ResumeProfileExtractionError'
        && error.message.includes('DASHSCOPE_API_KEY'),
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.ok(Date.now() - startedAt < 1_000, 'missing AI configuration should fail before network I/O');
}

async function testConfirmedResumeGate() {
  const { requireConfirmedResume } = await import('../src/lib/resume-access');

  const incomplete = await requireConfirmedResume(
    createResumeClient({
      id: 7,
      processing_status: 'needs_confirmation',
      segmentation_confirmed: false,
      profile: { education: [] },
      segmentation: {},
      profile_version: 1,
    }) as never,
    7,
    'user-a',
  );
  assert.equal(incomplete.ok, false);
  if (!incomplete.ok) assert.equal(incomplete.status, 409);

  const ready = await requireConfirmedResume(
    createResumeClient({
      id: 7,
      processing_status: 'ready',
      segmentation_confirmed: true,
      profile: { education: [] },
      segmentation: {},
      profile_version: 2,
    }) as never,
    7,
    'user-a',
  );
  assert.equal(ready.ok, true);
}

async function main() {
  await testResumeSegmentation();
  await testMissingResumeAiConfigurationFailsFast();
  await testConfirmedResumeGate();
  console.log('phase2 regression tests passed');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
