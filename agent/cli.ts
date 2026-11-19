#!/usr/bin/env node
/**
 * Liorvix 本地投递 Agent
 *
 * 用法：
 *   pnpm agent login --token=<access_token> [--api=https://liorvix.com] [--resume-id=12]
 *   pnpm agent doctor
 *   pnpm agent open https://boards.greenhouse.io/xxx        # 打开带持久化登录态的浏览器
 *   pnpm agent run --urls=jobs.txt --dry-run                # 默认演练：填到提交页停下
 *   pnpm agent run --urls=jobs.json --submit --max=5        # 真提交（谨慎）
 *
 * 为什么是本地程序而不是网页/扩展：需要复用用户自己的登录态、原生文件路径、连续多页操作，
 * 这三件事在浏览器沙箱里都做不到；密码始终留在用户机器上。
 */
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { checkSession, createServerResolver, downloadResume } from './api';
import { launchBrowser, resolveChannel } from './browser';
import { CONFIG_PATH, loadConfig, saveConfig, type AgentConfig } from './config';
import { runApplication } from './flow';
import type { AgentJob, ApplicationResult } from './types';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => item.startsWith(prefix));
  if (hit) return hit.slice(prefix.length).trim() || undefined;
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) {
    const next = process.argv[index + 1];
    if (next && !next.startsWith('--')) return next.trim();
  }
  return undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function log(message: string) {
  process.stdout.write(`${message}\n`);
}

async function commandLogin() {
  const token = arg('token');
  const apiBase = arg('api');
  const resumeIdRaw = arg('resume-id');
  const resumeId = resumeIdRaw ? Number(resumeIdRaw) : undefined;

  if (!token) {
    log('需要 Liorvix 的访问令牌。获取方式：');
    log('  1. 在浏览器登录 https://liorvix.com');
    log('  2. 打开开发者工具 → Application → Local Storage → https://liorvix.com');
    log('  3. 找到键名以 sb- 开头、以 -auth-token 结尾的项，复制其中的 access_token');
    log('  4. 运行：pnpm agent login --token=<access_token> [--resume-id=<简历ID>]');
    return;
  }

  const saved = await saveConfig({
    token,
    ...(apiBase ? { apiBase } : {}),
    ...(Number.isInteger(resumeId) && resumeId! > 0 ? { resumeId } : {}),
  });
  log(`已保存到 ${CONFIG_PATH}`);
  log(`API: ${saved.apiBase}`);
  const session = await checkSession(saved);
  log(session.ok ? `✅ ${session.detail}` : `⚠️  ${session.detail}`);
}

async function commandDoctor() {
  const config = await loadConfig();
  log(`配置：${CONFIG_PATH}`);
  log(`API：${config.apiBase}`);
  log(`浏览器：${resolveChannel(config)}`);
  log(`Profile：${config.profileDir}${existsSync(config.profileDir) ? '' : '（尚未创建，首次运行会生成）'}`);

  const engine = path.join(process.cwd(), 'extension', 'engine.js');
  log(`DOM 引擎：${existsSync(engine) ? '✅' : '❌ 缺少 extension/engine.js'}`);

  const session = await checkSession(config);
  log(session.ok ? `账号：✅ ${session.detail}` : `账号：⚠️  ${session.detail}`);

  if (config.resumePath) log(`简历：${existsSync(config.resumePath) ? '✅' : '❌'} ${config.resumePath}`);
  else if (config.resumeId) log(`简历：将从 Liorvix 下载（ID ${config.resumeId}）`);
  else log('简历：未配置，上传步骤会被跳过（--resume=<本地 PDF 路径> 或 --resume-id=<ID>）');
}

async function commandOpen() {
  const url = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'about:blank';
  const config = await loadConfig();
  log(`使用持久化 profile 打开 ${url}`);
  log('在这个窗口里登录雇主账号，登录态会保存下来供后续投递复用。按 Ctrl+C 关闭。');
  const context = await launchBrowser(config);
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(url).catch(() => undefined);
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => resolve());
    context.on('close', () => resolve());
  });
  await context.close().catch(() => undefined);
}

async function loadJobs(source: string): Promise<AgentJob[]> {
  const raw = await fs.readFile(source, 'utf8');
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as AgentJob[] | { jobs: AgentJob[] };
    const jobs = Array.isArray(parsed) ? parsed : parsed.jobs;
    return jobs.filter((job) => typeof job?.url === 'string' && job.url.startsWith('http'));
  }
  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('http'))
    .map((url) => ({ url }));
}

async function ensureResume(config: AgentConfig): Promise<string | undefined> {
  const explicit = arg('resume');
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`找不到简历文件：${explicit}`);
    return path.resolve(explicit);
  }
  if (config.resumePath && existsSync(config.resumePath)) return path.resolve(config.resumePath);
  if (config.resumeId) {
    const target = path.join(path.dirname(CONFIG_PATH), `resume-${config.resumeId}.pdf`);
    if (existsSync(target)) return target;
    log(`从 Liorvix 下载简历 #${config.resumeId} …`);
    return downloadResume(config, target);
  }
  return undefined;
}

function printResult(result: ApplicationResult, index: number) {
  const label = result.job.company ? `${result.job.company} · ${result.job.title || ''}` : result.job.url;
  const seconds = Math.round(result.durationMs / 1000);
  log('');
  log(`#${index + 1} ${label}`);
  log(`  状态：${result.status}（${seconds}s，${result.steps.length} 步）`);
  for (const step of result.steps) {
    log(
      `  第 ${step.index + 1} 步：识别 ${step.stats.resolved}/${step.stats.total}，填入 ${step.filled}，` +
        `待人工 ${step.pendingRequired.length}，失败 ${step.failed.length}`,
    );
    for (const item of step.pendingRequired.slice(0, 6)) log(`     · 待补（必填）：${item.label}`);
    for (const item of step.reviewFields.slice(0, 6)) log(`     · 待你确认：${item.label}${item.suggested ? `（建议 ${item.suggested}）` : ''}`);
    for (const item of step.failed.slice(0, 6)) log(`     · 失败：${item.label} — ${item.reason}`);
    for (const upload of step.uploads) log(`     · 上传：${upload.ok ? '成功' : `失败（${upload.reason || '未知'}）`} ${upload.target || ''}`);
  }
  if (result.receipt?.confirmationNumber) log(`  确认号：${result.receipt.confirmationNumber}`);
  if (result.error) log(`  说明：${result.error}`);
}

async function commandRun() {
  const config = await loadConfig();
  const session = await checkSession(config);
  if (!session.ok) {
    log(`⚠️  ${session.detail}`);
    log('仍然可以运行，但解析会失败。先执行 pnpm agent login。');
  }

  const urlsArg = arg('urls');
  if (!urlsArg) throw new Error('缺少 --urls=<文件>（每行一个岗位链接，或 JSON 数组）');
  const jobs = await loadJobs(urlsArg);
  const max = Number(arg('max') || config.maxJobs);
  const selected = jobs.slice(0, Number.isFinite(max) && max > 0 ? max : jobs.length);
  const mode: 'dry-run' | 'submit' = flag('submit') ? 'submit' : 'dry-run';
  const outDir = path.resolve(arg('out') || path.join('output', `apply-${Date.now()}`));
  const screenshotDir = path.join(outDir, 'screenshots');
  const resumePath = await ensureResume(config);

  log(`共 ${selected.length} 个岗位，模式：${mode === 'submit' ? '真实提交' : '演练（停在提交页）'}`);
  if (!resumePath) log('⚠️  没有可用简历，上传步骤会跳过');
  if (mode === 'submit') log('⚠️  真实提交模式：会替你在雇主网站点击提交，请确认清单无误。');

  const context = await launchBrowser(config, { headless: flag('headless') });
  const results: ApplicationResult[] = [];
  try {
    const page = context.pages()[0] || (await context.newPage());
    for (const [index, job] of selected.entries()) {
      log(`\n→ (${index + 1}/${selected.length}) ${job.url}`);
      const result = await runApplication({
        page,
        job,
        resolve: createServerResolver(config, job),
        resumePath,
        mode,
        screenshotDir,
        maxSteps: Number(arg('max-steps') || 8),
        log: (message) => log(`   ${message}`),
      });
      results.push(result);
      printResult(result, index);
      await fs.mkdir(outDir, { recursive: true });
      await fs.writeFile(path.join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
    }
  } finally {
    await context.close().catch(() => undefined);
  }

  const summary = results.reduce<Record<string, number>>((accumulator, result) => {
    accumulator[result.status] = (accumulator[result.status] || 0) + 1;
    return accumulator;
  }, {});
  log('');
  log(`完成：${Object.entries(summary).map(([status, count]) => `${status}=${count}`).join('  ') || '无结果'}`);
  log(`报告：${path.join(outDir, 'results.json')}`);
  log(`截图：${screenshotDir}`);
}

async function main() {
  const command = process.argv[2] || 'doctor';
  if (command === 'login') return commandLogin();
  if (command === 'doctor') return commandDoctor();
  if (command === 'open') return commandOpen();
  if (command === 'run') return commandRun();
  log(`未知命令：${command}`);
  log('可用命令：login / doctor / open <url> / run --urls=<file>');
  process.exitCode = 1;
}

main().catch((error) => {
  log(`❌ ${(error as Error).message}`);
  process.exitCode = 1;
});
