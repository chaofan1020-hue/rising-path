import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AgentConfig {
  apiBase: string;
  token: string;
  resumeId?: number;
  resumePath?: string;
  profileDir: string;
  channel: 'chrome' | 'msedge';
  maxJobs: number;
}

export const CONFIG_DIR = path.join(os.homedir(), '.liorvix-agent');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export const DEFAULT_CONFIG: AgentConfig = {
  apiBase: 'https://liorvix.com',
  token: '',
  profileDir: path.join(CONFIG_DIR, 'profile'),
  channel: 'chrome',
  maxJobs: 20,
};

export async function loadConfig(): Promise<AgentConfig> {
  let stored: Partial<AgentConfig> = {};
  try {
    stored = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8')) as Partial<AgentConfig>;
  } catch {
    stored = {};
  }
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    apiBase: (process.env.LIORVIX_API_BASE || stored.apiBase || DEFAULT_CONFIG.apiBase).replace(/\/$/, ''),
    token: process.env.LIORVIX_TOKEN || stored.token || '',
    resumePath: process.env.LIORVIX_RESUME || stored.resumePath || undefined,
  };
}

export async function saveConfig(patch: Partial<AgentConfig>): Promise<AgentConfig> {
  const current = await loadConfig();
  const next = { ...current, ...patch, apiBase: (patch.apiBase || current.apiBase).replace(/\/$/, '') };
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}
