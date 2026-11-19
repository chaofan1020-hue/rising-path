import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext } from 'playwright-core';
import type { AgentConfig } from './config';

const WINDOWS_CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const WINDOWS_EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];


export function resolveChannel(config: AgentConfig): 'chrome' | 'msedge' {
  if (config.channel === 'chrome' && WINDOWS_CHROME.some((file) => existsSync(file))) return 'chrome';
  if (process.platform === 'win32') {
    if (WINDOWS_CHROME.some((file) => existsSync(file))) return 'chrome';
    if (WINDOWS_EDGE.some((file) => existsSync(file))) return 'msedge';
  }
  return config.channel;
}

/**
 * 持久化 profile 的意义：用户登录一次雇主账号，之后所有投递都复用这份会话。
 * 密码永远不进入 Liorvix：我们只用浏览器已有的 cookie。
 */
export async function launchBrowser(config: AgentConfig, options: { headless?: boolean } = {}): Promise<BrowserContext> {
  await fs.mkdir(config.profileDir, { recursive: true });
  const channel = resolveChannel(config);
  const context = await chromium.launchPersistentContext(path.resolve(config.profileDir), {
    channel,
    headless: options.headless ?? false,
    viewport: { width: 1440, height: 960 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
  });
  context.setDefaultTimeout(20_000);
  return context;
}
