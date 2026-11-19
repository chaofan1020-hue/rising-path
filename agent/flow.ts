/**
 * 单岗位投递流程：打开 → 扫描 → 解析 → 填写 → 上传 → 翻页 → 停在提交页（或提交）。
 *
 * 与扩展的区别：这里没有「用户点一下」的限制，可以连续跑多步，
 * 所以每一步都要留下证据（字段、失败项、截图、指纹），供事后报告与归因。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Frame, Page } from 'playwright-core';
import {
  ENGINE_PATH,
  type ApplicationResult,
  type ResolvedField,
  type RunOptions,
  type ScanResolution,
  type StepResult,
  type UploadResult,
} from './types';

const RECEIPT_PATTERNS = [
  /thank you for (applying|your application)/i,
  /application (was|has been) (received|submitted)/i,
  /we('|’)ve received your application/i,
  /successfully (submitted|applied)/i,
  /申请(已)?(提交|投递)成功/i,
  /确定.*已收到您的申请/i,
];

const CONFIRMATION_PATTERN = /(?:confirmation|reference|application)\s*(?:number|id|no\.?|#)?\s*(?:is|was|:)?\s*[:：#]?\s*([A-Z0-9][A-Z0-9-]{4,})/i;

interface FrameScan {
  frame: Frame;
  index: number;
  scan: {
    fields: Array<Record<string, unknown>>;
    automationIds?: string[];
    pageText?: string;
    url?: string;
  } | null;
}

function logLine(log: (message: string) => void, message: string) {
  log(`[agent] ${message}`);
}

async function settle(page: Page, settleMs: number) {
  await page.waitForTimeout(Math.max(150, settleMs));
  try {
    await page.waitForLoadState('networkidle', { timeout: 4_000 });
  } catch {
    // 站点常驻长连接，拿不到 networkidle 不算失败
  }
  await page.waitForTimeout(200);
}

async function injectEngine(frames: Frame[]) {
  for (const frame of frames) {
    try {
      await frame.addScriptTag({ path: ENGINE_PATH });
    } catch {
      // 某些 frame 不允许注入（about:blank / 已卸载），跳过
    }
  }
}

async function evaluateSafely<T>(frame: Frame, fn: () => T): Promise<T | null> {
  try {
    return await frame.evaluate(fn);
  } catch {
    return null;
  }
}

async function scanFrames(page: Page): Promise<FrameScan[]> {
  const frames = page.frames().filter((frame) => !frame.isDetached());
  await injectEngine(frames);
  const scans: FrameScan[] = [];
  for (const [index, frame] of frames.entries()) {
    const scan = await evaluateSafely(frame, () => (window as unknown as {
      __liorvixEngine?: { scan: () => unknown };
    }).__liorvixEngine?.scan?.() as unknown);
    if (!scan) continue;
    const typed = scan as { fields?: Array<Record<string, unknown>> };
    if (!typed.fields || typed.fields.length === 0) continue;
    scans.push({
      frame,
      index,
      scan: scan as { fields: Array<Record<string, unknown>>; automationIds?: string[]; pageText?: string; url?: string },
    });
  }
  return scans;
}


async function runFill(frame: Frame, items: Array<{ key: string; value: string; type?: string }>) {
  try {
    return await frame.evaluate((payload: Array<{ key: string; value: string; type?: string }>) => {
      const engine = (window as unknown as {
        __liorvixEngine?: { fill: (values: unknown) => Promise<unknown[]> };
      }).__liorvixEngine;
      if (!engine) return [{ key: '*', filled: false, reason: 'DOM 引擎未注入' }];
      return engine.fill(payload);
    }, items) as Array<{ key: string; filled: boolean; reason?: string; value?: string }>;
  } catch (error) {
    return items.map((item) => ({ key: item.key, filled: false, reason: `填写失败: ${(error as Error).message}` }));
  }
}

async function uploadResume(page: Page, uploads: Array<{ selector: string; kind: string }>, resumePath: string): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  const resumeSelectors = uploads.filter((upload) => upload.kind === 'resume').map((upload) => upload.selector);
  for (const [index, frame] of page.frames().entries()) {
    if (frame.isDetached()) continue;
    let target:
      | ReturnType<Frame['locator']>
      | null = null;
    let targetLabel = '';
    for (const selector of resumeSelectors) {
      const candidate = frame.locator(selector).first();
      const count = await candidate.count().catch(() => 0);
      if (count > 0) {
        target = candidate;
        targetLabel = selector;
        break;
      }
    }
    if (!target) {
      const byAttribute = frame
        .locator('input[type="file"][name*="resume" i], input[type="file"][id*="resume" i], input[type="file"][name*="cv" i]')
        .first();
      if (await byAttribute.count().catch(() => 0)) {
        target = byAttribute;
        targetLabel = 'input[type=file][name*=resume]';
      }
    }
    if (!target) {
      const anyFile = frame.locator('input[type="file"]').first();
      if (await anyFile.count().catch(() => 0)) {
        target = anyFile;
        targetLabel = 'input[type=file]';
      }
    }
    if (!target) continue;

    try {
      await target.setInputFiles(resumePath, { timeout: 15_000 });
      const count = await target.evaluate((element: Element) => (element as HTMLInputElement).files?.length ?? 0);
      results.push({ frame: index, ok: count > 0, target: targetLabel });
    } catch (error) {
      results.push({ frame: index, ok: false, target: targetLabel, reason: (error as Error).message });
    }
  }
  return results;
}

async function frameFingerprint(frame: Frame): Promise<string> {
  const value = await evaluateSafely(frame, () => (window as unknown as {
    __liorvixEngine?: { fingerprint: () => string };
  }).__liorvixEngine?.fingerprint?.() || '');
  return String(value || '');
}

async function waitForStepChange(page: Page, previous: string, url: string, timeoutMs = 20_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await page.waitForTimeout(350);
    if (page.url() !== url) return true;
    const frames = page.frames().filter((frame) => !frame.isDetached());
    const after = (await Promise.all(frames.map((frame) => frameFingerprint(frame)))).join('#');
    if (after && after !== previous) return true;
  }
  return false;
}

async function advance(page: Page, next: string[], submit: string[]) {
  for (const frame of page.frames().filter((item) => !item.isDetached())) {
    try {
      const result = await frame.evaluate((payload: { next: string[]; submit: string[] }) => {
        const engine = (window as unknown as {
          __liorvixEngine?: { advance: (options: unknown) => { action: string; text: string } };
        }).__liorvixEngine;
        if (!engine) return { action: 'none', text: '' };
        return engine.advance(payload);
      }, { next, submit });
      if (result && result.action !== 'none') return result as { action: 'clicked_next' | 'needs_submit' | 'none'; text: string };
    } catch {
      continue;
    }
  }
  return { action: 'none' as const, text: '' };
}

async function clickSubmit(page: Page, submit: string[]) {
  for (const frame of page.frames().filter((item) => !item.isDetached())) {
    try {
      const result = await frame.evaluate((payload: { submit: string[] }) => {
        const engine = (window as unknown as {
          __liorvixEngine?: { clickSubmit: (selectors: string[]) => { ok: boolean; reason?: string } };
        }).__liorvixEngine;
        if (!engine) return { ok: false, reason: '引擎缺失' };
        return engine.clickSubmit(payload.submit);
      }, { submit });
      if (result && result.ok) return { ok: true };
      if (result && result.reason && result.reason !== '提交按钮不存在或不可用') return result;
    } catch {
      continue;
    }
  }
  return { ok: false, reason: '提交按钮不存在或不可用' };
}

async function detectReceipt(page: Page) {
  const text = await evaluateSafely(page.mainFrame(), () => {
    const body = document.body;
    return body ? body.innerText.slice(0, 6_000) : '';
  });
  const url = page.url();
  const haystack = `${text || ''} ${url.replace(/[-_/]/g, ' ')}`;
  const matched = RECEIPT_PATTERNS.some((pattern) => pattern.test(haystack));
  const confirmation = (text || '').match(CONFIRMATION_PATTERN)?.[1];
  if (!matched && !confirmation) return null;
  return {
    url,
    text: (text || '').slice(0, 500),
    confirmationNumber: confirmation,
  };
}

function screenshotPath(dir: string | undefined, index: number, step: number): string | undefined {
  if (!dir) return undefined;
  return path.join(dir, `job-${String(index + 1).padStart(2, '0')}-step-${String(step + 1).padStart(2, '0')}.png`);
}

export async function runApplication(options: RunOptions): Promise<ApplicationResult> {
  const started = Date.now();
  const log = options.log || (() => {});
  const settleMs = options.settleMs ?? 800;
  const maxSteps = options.maxSteps ?? 8;
  const steps: StepResult[] = [];
  const result: ApplicationResult = { job: options.job, status: 'failed', steps, durationMs: 0 };

  if (options.screenshotDir) {
    await fs.mkdir(options.screenshotDir, { recursive: true });
  }

  try {
    logLine(log, `打开 ${options.job.url}`);
    await options.page.goto(options.job.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await settle(options.page, settleMs);
  } catch (error) {
    result.error = `打开岗位页失败: ${(error as Error).message}`;
    result.durationMs = Date.now() - started;
    return result;
  }

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
    // 1) 先上传：很多 ATS 在上传简历后会用自家解析器回填，我们只补差集
    let uploads: UploadResult[] = [];
    if (options.resumePath) {
      uploads = await uploadResume(options.page, [], options.resumePath);
      if (uploads.some((upload) => upload.ok)) await options.page.waitForTimeout(1_200);
    }

    // 2) 扫描所有 frame
    const scans = await scanFrames(options.page);
    if (scans.length === 0) {
      steps.push({
        index: stepIndex,
        url: options.page.url(),
        fingerprint: '',
        stats: { total: 0, resolved: 0, fillable: 0, needsReview: 0, recipeHit: 0, coverage: 0 },
        fields: [],
        filled: 0,
        failed: [],
        pendingRequired: [],
        uploads,
        reviewFields: [],
        advance: { action: 'none', text: '' },
      });
      result.error = '页面上没有扫描到任何可填写字段';
      result.status = 'failed';
      break;
    }

    const fields: Array<Record<string, unknown>> = [];
    for (const item of scans) {
      for (const field of item.scan!.fields) {
        fields.push({ ...field, key: `${item.index}:${String(field.key)}` });
      }
    }
    const automationIds = Array.from(new Set(scans.flatMap((item) => item.scan!.automationIds || [])));
    const pageText = scans[0].scan!.pageText || '';

    // 3) 解析
    let resolution: ScanResolution;
    try {
      resolution = await options.resolve({ url: options.page.url(), fields, automationIds, pageText });
    } catch (error) {
      result.error = `解析失败: ${(error as Error).message}`;
      result.status = 'failed';
      break;
    }

    if (resolution.recipe?.uploads?.length && options.resumePath && uploads.length === 0) {
      uploads = await uploadResume(options.page, resolution.recipe.uploads, options.resumePath);
      if (uploads.some((upload) => upload.ok)) await options.page.waitForTimeout(1_200);
    }

    // 4) 填写：只写有值且不是高敏的字段；高敏字段留给报告提醒
    const valuesByFrame = new Map<number, Array<{ key: string; value: string; type?: string }>>();
    const reviewFields: Array<{ key: string; label: string; suggested?: string }> = [];
    for (const field of resolution.fields) {
      if (!field.value) continue;
      if (field.sensitive) {
        // 高敏字段（EEO、授权签名、婚育签证等）永远不代答，只在报告里给出建议值。
        reviewFields.push({ key: field.key, label: field.label, suggested: field.value });
        continue;
      }
      const [frameIndexRaw, ...rest] = field.key.split(':');
      const frameIndex = Number(frameIndexRaw);
      const rawKey = rest.join(':');
      const bucket = valuesByFrame.get(frameIndex) || [];
      bucket.push({ key: rawKey, value: field.value, type: field.type });
      valuesByFrame.set(frameIndex, bucket);
    }

    const failed: StepResult['failed'] = [];
    let filled = 0;
    for (const item of scans) {
      const items = valuesByFrame.get(item.index) || [];
      if (items.length === 0) continue;
      const outcomes = await runFill(item.frame, items);
      for (const outcome of outcomes) {
        const prefixedKey = `${item.index}:${outcome.key}`;
        if (outcome.filled) {
          filled += 1;
        } else {
          const field = resolution.fields.find((candidate) => candidate.key === prefixedKey);
          failed.push({ key: prefixedKey, label: field?.label || String(outcome.key), reason: outcome.reason || '未知原因' });
        }
      }
    }

    // 只把「必填且没有答案」的字段当成硬缺口；可选的 EEO/授权题不拦流程。
    const pendingRequired = resolution.fields
      .filter((field) => !field.value && field.required)
      .map((field) => ({ key: field.key, label: field.label }));

    // 5) 截图
    const shot = screenshotPath(options.screenshotDir, 0, stepIndex);
    if (shot) {
      try {
        await options.page.screenshot({ path: shot, fullPage: true });
      } catch {
        // 截图失败不影响主流程
      }
    }

    // 6) 翻页判定
    const fingerprint = (await Promise.all(scans.map((item) => frameFingerprint(item.frame)))).join('#');
    const step: StepResult = {
      index: stepIndex,
      url: options.page.url(),
      fingerprint,
      stats: resolution.stats,
      fields: resolution.fields,
      filled,
      failed,
      pendingRequired,
      uploads,
      reviewFields,
      advance: { action: 'none', text: '' },
      screenshot: shot,
    };
    steps.push(step);
    logLine(
      log,
      `第 ${stepIndex + 1} 步：识别 ${resolution.stats.resolved}/${resolution.stats.total}，填入 ${filled}，` +
        `待确认 ${pendingRequired.length}，失败 ${failed.length}`,
    );

    // 有必填缺口就停下来等人，不硬着头皮投
    if (pendingRequired.length > 0 && !process.env.LIORVIX_AGENT_FORCE_ADVANCE) {
      result.status = 'needs_attention';
      break;
    }

    const nextSelectors = resolution.recipe?.steps
      ? resolution.recipe.steps.flatMap((recipeStep) => recipeStep.next || [])
      : [];
    const advanceResult = await advance(options.page, nextSelectors, resolution.recipe?.submit || []);
    step.advance = advanceResult;

    if (advanceResult.action === 'needs_submit') {
      if (options.mode === 'dry-run') {
        result.status = 'ready_to_submit';
        logLine(log, `到达提交页（${advanceResult.text || 'submit'}），演练模式不点提交`);
        break;
      }
      const clicked = await clickSubmit(options.page, resolution.recipe?.submit || []);
      if (!clicked.ok) {
        result.status = 'needs_attention';
        result.error = clicked.reason;
        break;
      }
      logLine(log, '已点击提交，等待回执…');
      await options.page.waitForTimeout(2_500);
      try {
        await options.page.waitForLoadState('networkidle', { timeout: 15_000 });
      } catch {
        // 回执页可能有长连接
      }
      const receipt = await detectReceipt(options.page);
      const receiptShot = screenshotPath(options.screenshotDir, 0, stepIndex + 1);
      if (receiptShot) {
        await options.page.screenshot({ path: receiptShot, fullPage: true }).catch(() => undefined);
      }
      if (receipt) {
        result.receipt = { ...receipt, screenshot: receiptShot };
        result.status = 'submitted';
      } else {
        result.status = 'needs_attention';
        result.error = '点击提交后没有识别到回执，请人工确认';
      }
      break;
    }

    if (advanceResult.action === 'none') {
      result.status = 'ready_to_submit';
      logLine(log, '没有找到"下一步"按钮，停在当前页');
      break;
    }

    const changed = await waitForStepChange(options.page, fingerprint, options.page.url());
    if (!changed) {
      result.status = 'needs_attention';
      result.error = '点击下一步后页面没有变化';
      break;
    }
  }

  result.durationMs = Date.now() - started;
  return result;
}
