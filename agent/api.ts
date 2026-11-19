import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AgentConfig } from './config';
import type { AgentJob, ResolveFn, ScanResolution } from './types';

export class AgentApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'AgentApiError';
  }
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return `HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}: ${text.slice(0, 160)}`;
  }
}

/** 服务端解析：配方 + 90 题词库 + 档案推导，默认零 AI。 */
export function createServerResolver(config: AgentConfig, job?: AgentJob): ResolveFn {
  return async (input) => {
    const response = await fetch(`${config.apiBase}/api/apply/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({
        url: input.url,
        fields: input.fields,
        automationIds: input.automationIds,
        pageText: input.pageText,
        resumeId: config.resumeId,
        jobId: job?.id,
      }),
    });
    if (!response.ok) throw new AgentApiError(`解析接口失败：${await readError(response)}`, response.status);
    return (await response.json()) as ScanResolution;
  };
}

/** 把 Liorvix 里的简历下载到本地临时文件，供 Playwright 原生上传。 */
export async function downloadResume(config: AgentConfig, destination: string): Promise<string> {
  if (!config.resumeId) throw new AgentApiError('没有配置 resumeId，无法下载简历');
  const response = await fetch(`${config.apiBase}/api/apply/resume-file?resumeId=${config.resumeId}`, {
    headers: { Authorization: `Bearer ${config.token}` },
  });
  if (!response.ok) throw new AgentApiError(`下载简历失败：${await readError(response)}`, response.status);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, buffer);
  return destination;
}

export async function checkSession(config: AgentConfig): Promise<{ ok: boolean; detail: string }> {
  if (!config.token) return { ok: false, detail: '还没有配置访问令牌（运行 `pnpm agent login`）' };
  try {
    const response = await fetch(`${config.apiBase}/api/application-profile`, {
      headers: { Authorization: `Bearer ${config.token}` },
    });
    if (response.status === 401) return { ok: false, detail: '访问令牌已失效，请重新登录 Liorvix 后复制新令牌' };
    if (!response.ok) return { ok: false, detail: `接口返回 ${response.status}` };
    return { ok: true, detail: '账号连接正常' };
  } catch (error) {
    return { ok: false, detail: `无法连接 ${config.apiBase}：${(error as Error).message}` };
  }
}
