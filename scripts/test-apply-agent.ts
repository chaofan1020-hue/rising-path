/**
 * 本地 Agent 端到端验证。
 *
 * 不需要外网、不需要真实 ATS：用两个本地夹具页面模拟
 *  - Workday 风格的三步向导（含上传、单选组、提交页）
 *  - Greenhouse 风格的单页表单（含 shadow DOM 输入框、自定义下拉、文件上传）
 *
 * 运行：pnpm test:agent
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { resolveScan } from '../src/lib/apply/resolve';
import { runApplication } from '../agent/flow';
import type { ApplicationProfile } from '../src/lib/application-profile';

const FIXTURES = path.join(process.cwd(), 'agent', 'fixtures');

const PROFILE: ApplicationProfile = {
  personal: {
    firstName: 'Alex',
    lastName: 'Chen',
    fullName: 'Alex Chen',
    email: 'alex.chen@example.com',
    phone: '+1 415 555 0132',
    address: '500 Howard St',
    city: 'San Francisco',
    state: 'CA',
    zipCode: '94105',
    country: 'United States',
  },
  links: { linkedin: 'https://linkedin.com/in/alexchen', github: 'https://github.com/alexchen', portfolio: '' },
  education: [
    {
      raw: 'University of Southern California | Master of Science | Computer Science | 3.82 | 2026-05',
      school: 'University of Southern California',
      degree: 'Master of Science',
      major: 'Computer Science',
      gpa: '3.82',
      endDate: '2026-05',
    },
  ],
  experience: [
    { raw: 'Acme Corp | Software Engineer Intern | 2025-06 - 2025-08', company: 'Acme Corp', role: 'Software Engineer Intern' },
  ],
  skills: ['TypeScript', 'Python'],
  languages: ['English', 'Mandarin'],
  workAuthorization: 'F-1 OPT, will require H-1B sponsorship in the future',
  visaStatus: 'F-1 OPT',
  summary: 'MS Computer Science student focused on distributed systems and developer tooling.',
};

function startFixtureServer(): Promise<{ base: string; close: () => Promise<void> }> {
  const routes: Record<string, string> = {
    '/workday-like': 'workday-like.html',
    '/greenhouse-like': 'greenhouse-like.html',
  };
  const server = createServer(async (request, response) => {
    const file = routes[(request.url || '').split('?')[0]];
    if (!file) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    try {
      const body = await readFile(path.join(FIXTURES, file));
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(body);
    } catch {
      response.writeHead(500);
      response.end('fixture missing');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

async function createPdf(target: string): Promise<string> {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');
  await writeFile(target, pdf);
  return target;
}

async function main() {
  const { base, close } = await startFixtureServer();
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'liorvix-agent-'));
  const resumePath = await createPdf(path.join(workDir, 'resume.pdf'));
  const shots = path.join(workDir, 'screenshots');

  let browser: Browser | null = null;
  let passed = 0;
  let failed = 0;
  const check = (label: string, run: () => void) => {
    try {
      run();
      passed += 1;
      console.log(`  ✅ ${label}`);
    } catch (error) {
      failed += 1;
      console.log(`  ❌ ${label}\n     ${(error as Error).message}`);
    }
  };

  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    // ---------------------------------------------------------------- Workday 演练
    console.log('Workday 风格三步向导（演练模式）');
    const dryRun = await runApplication({
      page,
      job: { url: `${base}/workday-like`, company: 'Fixture Co', title: 'SWE Intern' },
      resolve: (input) => Promise.resolve(resolveScan(input as unknown as Parameters<typeof resolveScan>[0], PROFILE)),
      resumePath,
      mode: 'dry-run',
      screenshotDir: shots,
      settleMs: 150,
      log: () => {},
    });

    check('演练习停在提交页', () => assert.equal(dryRun.status, 'ready_to_submit'));
    check('走完三步', () => assert.equal(dryRun.steps.length, 3));
    check('第一步识别到表单字段', () => assert.ok(dryRun.steps[0].stats.resolved >= 3, JSON.stringify(dryRun.steps[0].stats)));
    check('第一步填写成功', () => assert.ok(dryRun.steps[0].filled >= 3));
    check('简历已上传', () => assert.ok(dryRun.steps.some((step) => step.uploads.some((upload) => upload.ok))));
    check('最后一步检测到提交按钮', () => assert.equal(dryRun.steps[2].advance.action, 'needs_submit'));
    check('没有点提交', () => assert.equal(dryRun.status === 'submitted', false));
    assert.ok(dryRun.steps[0].screenshot, '缺少截图');

    // ---------------------------------------------------------------- Workday 提交
    console.log('Workday 风格三步向导（真实提交模式）');
    const submitRun = await runApplication({
      page,
      job: { url: `${base}/workday-like`, company: 'Fixture Co', title: 'SWE Intern' },
      resolve: (input) => Promise.resolve(resolveScan(input as unknown as Parameters<typeof resolveScan>[0], PROFILE)),
      resumePath,
      mode: 'submit',
      screenshotDir: shots,
      settleMs: 150,
      log: () => {},
    });

    check('提交成功', () => assert.equal(submitRun.status, 'submitted'));
    check('识别到确认号', () => assert.equal(submitRun.receipt?.confirmationNumber, 'APP-884213'));

    const submitted = await page.evaluate(() => (window as unknown as { __submitted?: Record<string, unknown> }).__submitted || {});
    check('姓名写入正确', () => assert.equal(submitted.firstName, 'Alex'));
    check('邮箱写入正确', () => assert.equal(submitted.email, 'alex.chen@example.com'));
    check('学校写入正确', () => assert.equal(submitted.school, 'University of Southern California'));
    check('学位映射为选项值', () => assert.equal(submitted.degree, 'master'));
    check('Sponsor 问题按档案推导为 Yes', () => assert.equal(submitted.sponsorship, 'yes'));
    check('Cover letter 复用档案 summary', () => assert.ok(String(submitted.coverLetter).startsWith('MS Computer Science')));
    check('提交时简历文件名正确', () => assert.equal(submitted.resume, 'resume.pdf'));

    // ---------------------------------------------------------------- Greenhouse
    console.log('Greenhouse 风格单页表单（shadow DOM + 自定义下拉）');
    const greenhouse = await runApplication({
      page,
      job: { url: `${base}/greenhouse-like`, company: 'Fixture Co', title: 'SWE' },
      resolve: (input) => Promise.resolve(resolveScan(input as unknown as Parameters<typeof resolveScan>[0], PROFILE)),
      resumePath,
      mode: 'dry-run',
      screenshotDir: shots,
      settleMs: 150,
      log: () => {},
    });

    check('停在提交页', () => assert.equal(greenhouse.status, 'ready_to_submit'));

    const shadowEmail = await page.evaluate(() => {
      const host = document.getElementById('shadowHost');
      const input = host?.shadowRoot?.getElementById('shadow-email') as HTMLInputElement | null;
      return input?.value || '';
    });
    check('穿透 shadow DOM 写入邮箱', () => assert.equal(shadowEmail, 'alex.chen@example.com'));

    const country = await page.evaluate(() => {
      const trigger = document.getElementById('countryTrigger');
      return trigger?.dataset.value || trigger?.textContent?.trim() || '';
    });
    check('自定义下拉选中国家', () => assert.equal(country, 'United States'));

    const uploadName = await page.evaluate(() => {
      const input = document.getElementById('resume') as HTMLInputElement | null;
      return input?.files?.[0]?.name || '';
    });
    check('文件上传成功', () => assert.equal(uploadName, 'resume.pdf'));

    const report = {
      generatedAt: new Date().toISOString(),
      passed,
      failed,
      workday: {
        dryRun: { status: dryRun.status, steps: dryRun.steps.map((step) => ({ filled: step.filled, stats: step.stats })) },
        submitted: { status: submitRun.status, confirmation: submitRun.receipt?.confirmationNumber },
      },
      greenhouse: {
        status: greenhouse.status,
        stats: greenhouse.steps[0]?.stats,
        failedFields: greenhouse.steps[0]?.failed,
        pending: greenhouse.steps[0]?.pendingRequired,
      },
    };
    await writeFile(path.join(workDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`\n报告：${path.join(workDir, 'report.json')}`);
    console.log(`截图：${shots}`);
  } finally {
    await browser?.close().catch(() => undefined);
    await close();
    if (failed === 0) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }

  console.log(`\n${failed === 0 ? '✅' : '❌'} agent e2e: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
