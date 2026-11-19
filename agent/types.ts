import path from 'node:path';

export const ENGINE_PATH = path.join(process.cwd(), 'extension', 'engine.js');

export interface AgentJob {
  id?: number;
  url: string;
  company?: string;
  title?: string;
}

/** 与 /api/apply/resolve 的返回结构保持一致（这里只声明 Agent 用到的字段）。 */
export interface ResolvedField {
  key: string;
  canonicalKey: string | null;
  label: string;
  value: string;
  semanticValue: string;
  source: string;
  confidence: number;
  needsReview: boolean;
  sensitive: boolean;
  method: string;
  reason?: string;
  type?: string;
  required?: boolean;
}

export interface ScanStats {
  total: number;
  resolved: number;
  fillable: number;
  needsReview: number;
  recipeHit: number;
  coverage: number;
}

export interface ScanResolution {
  recipe: {
    id: string;
    label: string;
    atsType: string;
    version: number;
    status: string;
    form?: { root?: string; inIframe?: boolean; multiStep?: boolean };
    uploads?: Array<{ selector: string; kind: string }>;
    submit?: string[];
    steps?: Array<{ name: string; detect: string[]; next?: string[] }>;
  } | null;
  recipeScore: number;
  fields: ResolvedField[];
  unresolved: Array<{ key: string; label: string; reason: string }>;
  stats: ScanStats;
}

export interface ScanInput {
  url: string;
  fields: Array<Record<string, unknown>>;
  automationIds: string[];
  pageText: string;
}

export type ResolveFn = (input: ScanInput) => Promise<ScanResolution>;

export interface UploadResult {
  frame: number;
  ok: boolean;
  target?: string;
  reason?: string;
}

export interface StepResult {
  index: number;
  url: string;
  fingerprint: string;
  stats: ScanStats;
  fields: ResolvedField[];
  filled: number;
  failed: Array<{ key: string; label: string; reason: string }>;
  pendingRequired: Array<{ key: string; label: string }>;
  uploads: UploadResult[];
  /** 高敏字段：Agent 不代答，留给用户在报告里确认。 */
  reviewFields: Array<{ key: string; label: string; suggested?: string }>;
  advance: { action: 'clicked_next' | 'needs_submit' | 'none'; text: string };
  screenshot?: string;
}

export interface ApplicationResult {
  job: AgentJob;
  status: 'ready_to_submit' | 'submitted' | 'needs_attention' | 'failed';
  steps: StepResult[];
  receipt?: {
    url: string;
    text?: string;
    confirmationNumber?: string;
    screenshot?: string;
  };
  error?: string;
  durationMs: number;
}

export interface RunOptions {
  page: import('playwright-core').Page;
  job: AgentJob;
  resolve: ResolveFn;
  /** 本地简历文件路径；有值时才尝试自动上传。 */
  resumePath?: string;
  mode: 'dry-run' | 'submit';
  maxSteps?: number;
  screenshotDir?: string;
  settleMs?: number;
  log?: (message: string) => void;
}
