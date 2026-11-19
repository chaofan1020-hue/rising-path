import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { jobHtmlToPlainText } from '@/lib/job-content';
import {
  LINKEDIN_CAREERS_URL,
  LINKEDIN_FEED_URL,
  LINKEDIN_SEARCH_URL,
  assertLinkedInFeedComplete,
  isLinkedInHiringCompany,
  isUsableLinkedInDescription,
  linkedInJobIdFromUrl,
  normalizeLinkedInJobUrl,
} from '@/lib/linkedin-official';

type CaptureFile = {
  generated_at?: string;
  search_url?: string;
  reported_total?: number | null;
  list_complete?: boolean;
  jobs?: unknown;
};

type FeedJob = {
  id: string;
  title: string;
  url: string;
  location: string | null;
  department: string | null;
  description: string;
  company: string;
  employment_type?: string | null;
  date_posted?: string | null;
  captured_at: string;
  source_reported_count: number;
  source_expected_count: number;
  source_complete: boolean;
  source_count_basis: string;
};

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function run(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: true });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} 退出码 ${code}`));
    });
  });
}

async function main(): Promise<void> {
  const inputPath = argument('input') || path.join('output', 'linkedin-browser-jobs-latest.json');
  const write = process.argv.includes('--write');
  const allowPartial = process.argv.includes('--allow-partial');
  if (write && process.env.LINKEDIN_BROWSER_JOBS_WRITE_ENABLED !== 'true') {
    throw new Error('写入默认关闭；请设置 LINKEDIN_BROWSER_JOBS_WRITE_ENABLED=true 再加 --write');
  }
  if (!existsSync(inputPath)) throw new Error(`找不到输入文件 ${inputPath}`);

  const payload = JSON.parse(await readFile(inputPath, 'utf8')) as CaptureFile;
  const items = Array.isArray(payload.jobs) ? payload.jobs : [];
  if (items.length === 0) throw new Error('输入文件必须包含 jobs 数组');

  const jobs: FeedJob[] = items.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`第 ${index + 1} 条不是对象`);
    const row = item as Record<string, unknown>;
    const url = normalizeLinkedInJobUrl(typeof row.url === 'string' ? row.url : null);
    const id = (typeof row.id === 'string' && /^\d+$/.test(row.id) ? row.id : null) || linkedInJobIdFromUrl(url);
    const title = typeof row.title === 'string' ? jobHtmlToPlainText(row.title) : '';
    const description = typeof row.description === 'string' ? jobHtmlToPlainText(row.description) : '';
    const company = typeof row.company === 'string' ? jobHtmlToPlainText(row.company) : 'LinkedIn';
    if (!id || !url) throw new Error(`第 ${index + 1} 条不是 LinkedIn 官方详情 URL`);
    if (linkedInJobIdFromUrl(url) !== id) throw new Error(`第 ${index + 1} 条 URL 与岗位 ID 不一致`);
    if (!title) throw new Error(`第 ${index + 1} 条缺少标题`);
    if (!isUsableLinkedInDescription(description)) throw new Error(`第 ${index + 1} 条正文过短或不可展示`);
    if (!isLinkedInHiringCompany(company)) throw new Error(`第 ${index + 1} 条招聘方不是 LinkedIn：${company}`);
    const capturedAt = typeof row.captured_at === 'string' ? row.captured_at : new Date().toISOString();
    if (!Number.isFinite(Date.parse(capturedAt))) throw new Error(`第 ${index + 1} 条 captured_at 无效`);
    return {
      id,
      title,
      url,
      location: typeof row.location === 'string' ? jobHtmlToPlainText(row.location) || null : null,
      department: typeof row.department === 'string' ? jobHtmlToPlainText(row.department) || null : null,
      description,
      company: 'LinkedIn',
      employment_type: typeof row.employment_type === 'string' ? row.employment_type : null,
      date_posted: typeof row.date_posted === 'string' ? row.date_posted : null,
      captured_at: capturedAt,
      source_reported_count: 0,
      source_expected_count: 0,
      source_complete: Boolean(payload.list_complete),
      source_count_basis: payload.list_complete ? 'complete_official_list' : 'partial_browser_capture',
    };
  });

  const unique = new Map(jobs.map((job) => [job.id, job]));
  const feedJobs = [...unique.values()].map((job) => ({
    ...job,
    source_reported_count: payload.reported_total || unique.size,
    source_expected_count: unique.size,
    source_complete: Boolean(payload.list_complete),
    source_count_basis: payload.list_complete ? 'complete_official_list' : 'partial_browser_capture',
  }));
  assertLinkedInFeedComplete({
    jobs: feedJobs,
    reportedTotal: payload.reported_total ?? null,
    listComplete: Boolean(payload.list_complete),
    allowPartial,
  });

  const feed = {
    generated_at: payload.generated_at || new Date().toISOString(),
    search_url: payload.search_url || LINKEDIN_SEARCH_URL,
    careers_url: LINKEDIN_CAREERS_URL,
    reported_total: payload.reported_total ?? feedJobs.length,
    list_complete: Boolean(payload.list_complete),
    jobs: feedJobs,
  };
  const feedPath = path.join('output', 'linkedin-official-feed.json');
  await writeFile(feedPath, JSON.stringify(feed));
  const summary = {
    mode: write ? 'write' : 'dry_run',
    input: inputPath,
    feed: feedPath,
    jobs: feedJobs.length,
    reported_total: feed.reported_total,
    list_complete: feed.list_complete,
    desc_ge_300: feedJobs.filter((job) => job.description.length >= 300).length,
    locations: feedJobs.filter((job) => job.location).length,
    feed_url: LINKEDIN_FEED_URL,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!write) return;

  const remote = ['scripts/collector-remote.mjs'];
  await run('node', [...remote, 'put', feedPath, '/tmp/linkedin-official-jobs.json'], 180_000);
  await run('node', [...remote, 'run', 'output/collector-cmd-linkedin-install-feed.sh', '--timeout=120000'], 180_000);
  await run('node', [...remote, 'run', 'output/collector-cmd-linkedin-register.sh', '--timeout=120000'], 180_000);
  await run('node', [...remote, 'run', 'output/collector-cmd-linkedin-poll.sh', '--timeout=180000'], 240_000);
  await run('node', [...remote, 'run', 'output/collector-cmd-linkedin-qa.sh', '--timeout=120000'], 180_000);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
