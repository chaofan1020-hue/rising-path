import type { JobsFeedItem } from '@/lib/jobs-feed';

interface GreenhouseOffice {
  name?: unknown;
  location?: unknown;
}

interface GreenhouseJob {
  id?: unknown;
  offices?: GreenhouseOffice[] | null;
}

interface GreenhouseBoard {
  jobs?: GreenhouseJob[];
}

const BOARD_CONCURRENCY = 3;
const FETCH_TIMEOUT_MS = 15_000;
const BOARD_CACHE_TTL_MS = 30 * 60_000;
const boardOfficeCache = new Map<string, { expiresAt: number; offices: Map<string, GreenhouseOffice[]> }>();

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function hasOffices(item: JobsFeedItem): boolean {
  return Array.isArray(item.offices) && item.offices.length > 0;
}

function genericLocationLabel(value: unknown, depth = 0): string {
  if (depth > 2 || value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return value.map((item) => genericLocationLabel(item, depth + 1)).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return genericLocationLabel(record.name ?? record.label ?? record.location, depth + 1);
  }
  return '';
}

function needsOfficeEnrichment(item: JobsFeedItem): boolean {
  const label = genericLocationLabel(item.location).toLowerCase();
  // Preserve explicit cities/countries from the collector. These generic ATS
  // labels do not say where a candidate may actually work.
  if (!label) return true;
  const parts = label.split(/[;,/|]|\s+or\s+/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => /^(hybrid|in[ -]?office|remote|distributed|global|multiple locations|various locations)$/i.test(part));
}

/**
 * Greenhouse's public list endpoints identify a job with a board token and
 * numeric ID. The collector can omit `offices` even though Greenhouse exposes
 * it, so retain only those two stable values for a direct official lookup.
 */
function parseGreenhouseReference(sourceUrl: string | null | undefined): { board: string; jobId: string } | null {
  if (!sourceUrl) return null;
  try {
    const url = new URL(sourceUrl);
    if (!/(^|\.)greenhouse\.io$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/\/(?:v1\/boards\/)?([^/]+)\/jobs\/(\d+)(?:\/|$)/i)
      || url.pathname.match(/\/boards\/([^/]+)\/jobs\/(\d+)(?:\/|$)/i);
    if (!match) return null;
    return { board: decodeURIComponent(match[1]), jobId: match[2] };
  } catch {
    return null;
  }
}

async function fetchBoardOffices(board: string): Promise<Map<string, GreenhouseOffice[]>> {
  const cached = boardOfficeCache.get(board);
  if (cached && cached.expiresAt > Date.now()) return cached.offices;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Greenhouse only includes the `offices` array when content is requested.
    // Without it, every Hybrid/In-Office role loses its geographic scope.
    const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Greenhouse ${board} returned HTTP ${response.status}`);
    const payload = await response.json() as GreenhouseBoard;
    const locations = new Map<string, GreenhouseOffice[]>();
    for (const job of payload.jobs || []) {
      const jobId = text(job.id);
      if (jobId && Array.isArray(job.offices) && job.offices.length > 0) locations.set(jobId, job.offices);
    }
    boardOfficeCache.set(board, { offices: locations, expiresAt: Date.now() + BOARD_CACHE_TTL_MS });
    return locations;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Augment generic Greenhouse location labels (for example `Hybrid`) with the
 * official office locations. This deliberately enriches only rows whose feed
 * payload omitted offices; it never turns an unverified worldwide job into a
 * target-market job.
 */
export async function enrichGreenhouseOffices(items: JobsFeedItem[]): Promise<JobsFeedItem[]> {
  const references = new Map<number, { board: string; jobId: string }>();
  const boards = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (hasOffices(item) || !needsOfficeEnrichment(item)) continue;
    const reference = parseGreenhouseReference(item.source_url);
    if (!reference) continue;
    references.set(index, reference);
    boards.add(reference.board);
  }
  if (references.size === 0) return items;

  const officeByBoard = new Map<string, Map<string, GreenhouseOffice[]>>();
  const boardNames = [...boards];
  for (let start = 0; start < boardNames.length; start += BOARD_CONCURRENCY) {
    const batch = boardNames.slice(start, start + BOARD_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(async (board) => [board, await fetchBoardOffices(board)] as const));
    for (const result of results) {
      if (result.status === 'fulfilled') {
        officeByBoard.set(result.value[0], result.value[1]);
      } else {
        // Location enrichment is optional. Preserve the current conservative
        // filter when an ATS is temporarily unavailable.
        console.warn('[JobsFeed] Greenhouse office enrichment failed:', result.reason);
      }
    }
  }

  return items.map((item, index) => {
    const reference = references.get(index);
    const offices = reference ? officeByBoard.get(reference.board)?.get(reference.jobId) : undefined;
    return offices ? { ...item, offices } : item;
  });
}
