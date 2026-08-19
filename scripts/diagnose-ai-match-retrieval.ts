import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: '.env.local', quiet: true });

type JsonRecord = Record<string, unknown>;

function textTerms(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/[^\p{L}\p{N}+#./-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && term.length <= 48);
}

function collectResumeTerms(resume: JsonRecord): string[] {
  const profile = resume.profile && typeof resume.profile === 'object'
    ? resume.profile as JsonRecord
    : {};
  const intention = profile.intention && typeof profile.intention === 'object'
    ? profile.intention as JsonRecord
    : {};
  const skills = Array.isArray(profile.skills) ? profile.skills : [];
  const roles = Array.isArray(intention.roles) ? intention.roles : [];
  const projects = Array.isArray(profile.projects) ? profile.projects : [];
  const experiences = [
    ...(Array.isArray(profile.internships) ? profile.internships : []),
    ...(Array.isArray(profile.workExperience) ? profile.workExperience : []),
  ];
  const sources = [
    ...skills,
    ...roles,
    ...projects.flatMap((item) => item && typeof item === 'object'
      ? [(item as JsonRecord).techStack, (item as JsonRecord).name]
      : []),
    ...experiences.flatMap((item) => item && typeof item === 'object'
      ? [(item as JsonRecord).role]
      : []),
  ];
  return [...new Set(sources.flatMap((source) => (
    Array.isArray(source) ? source.flatMap(textTerms) : textTerms(String(source || ''))
  )))].slice(0, 12);
}

async function main() {
  if (!process.env.SUPABASE_DB_URL) throw new Error('缺少 SUPABASE_DB_URL');
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    query_timeout: 30_000,
  });
  await client.connect();
  try {
    const resumes = await client.query<{
      id: number;
      user_id: string;
      profile: JsonRecord | null;
    }>(`
      select id, user_id, profile
      from public.resumes
      where processing_status = 'ready'
        and segmentation_confirmed = true
      order by updated_at desc
      limit 20
    `);

    const outcomes: Array<Record<string, unknown>> = [];
    const scopesToTest = [
      ['us', 'canada', 'uk', 'australia', 'hong_kong', 'singapore'],
      ['us'],
      ['uk'],
    ];
    for (const resume of resumes.rows) {
      const terms = collectResumeTerms({ profile: resume.profile });
      for (const scopes of scopesToTest) {
        const startedAt = performance.now();
        await client.query('begin');
        try {
          await client.query("set local role authenticated");
          await client.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
          await client.query("select set_config('request.jwt.claim.sub', $1, true)", [resume.user_id]);
          await client.query("set local statement_timeout = '10s'");
          const result = await client.query<{ count: number }>(`
            select count(*)::int as count
          from public.search_ai_match_candidates_v7($1::text[], array[]::text[], $2::text[], 80)
          `, [terms, scopes]);
          outcomes.push({
            resumeId: resume.id,
            scopes,
            termCount: terms.length,
            candidateCount: result.rows[0]?.count ?? 0,
            durationMs: Math.round(performance.now() - startedAt),
            status: 'ok',
          });
        } catch (error) {
          outcomes.push({
            resumeId: resume.id,
            scopes,
            termCount: terms.length,
            durationMs: Math.round(performance.now() - startedAt),
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          await client.query('rollback');
        }
      }
    }
    console.log(JSON.stringify({ tested: outcomes.length, outcomes }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '诊断失败');
  process.exitCode = 1;
});
