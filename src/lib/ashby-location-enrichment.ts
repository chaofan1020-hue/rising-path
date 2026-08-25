import type { JobsFeedItem } from '@/lib/jobs-feed';

interface AshbyJob {
  id?: unknown;
  address?: {
    postalAddress?: Record<string, unknown> | null;
  } | null;
  secondaryLocations?: unknown;
}

interface AshbyBoard {
  jobs?: AshbyJob[];
}

const BOARD_CONCURRENCY = 3;
const FETCH_TIMEOUT_MS = 15_000;
const BOARD_CACHE_TTL_MS = 30 * 60_000;
const boardLocationCache = new Map<string, { expiresAt: number; locations: Map<string, unknown> }>();

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function locationLabel(value: unknown, depth = 0): string {
  if (depth > 2 || value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return value.map((item) => locationLabel(item, depth + 1)).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return locationLabel(record.name ?? record.label ?? record.location, depth + 1);
  }
  return '';
}

function needsLocationEnrichment(item: JobsFeedItem): boolean {
  const location = locationLabel(item.location).toLowerCase();
  const country = locationLabel(item.country).toLowerCase();
  const parts = location.split(/[;,/|]|\s+or\s+/).map((part) => part.trim()).filter(Boolean);
  const genericLocation = !location || (parts.length > 0
    && parts.every((part) => /^(hybrid|in[ -]?office|remote|distributed|global|multiple locations|various locations)$/i.test(part)));
  return genericLocation && (!country || country === location);
}

function parseAshbyReference(sourceUrl: string | null | undefined): { board: string; jobId: string } | null {
  if (!sourceUrl) return null;
  try {
    const url = new URL(sourceUrl);
    if (!/(^|\.)ashbyhq\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return { board: decodeURIComponent(parts[0]), jobId: decodeURIComponent(parts[1]) };
  } catch {
    return null;
  }
}

function officialLocation(job: AshbyJob): unknown {
  const postalAddress = job.address?.postalAddress;
  const primary = postalAddress
    ? {
      city: postalAddress.addressLocality,
      state: postalAddress.addressRegion,
      country: postalAddress.addressCountry,
    }
    : null;
  const secondary = Array.isArray(job.secondaryLocations) ? job.secondaryLocations : [];
  const locations = [primary, ...secondary].filter(Boolean);
  return locations.length > 0 ? locations : null;
}

async function fetchBoardLocations(board: string): Promise<Map<string, unknown>> {
  const cached = boardLocationCache.get(board);
  if (cached && cached.expiresAt > Date.now()) return cached.locations;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Ashby ${board} returned HTTP ${response.status}`);
    const payload = await response.json() as AshbyBoard;
    const locations = new Map<string, unknown>();
    for (const job of payload.jobs || []) {
      const jobId = text(job.id);
      const location = officialLocation(job);
      if (jobId && location) locations.set(jobId, location);
    }
    boardLocationCache.set(board, { locations, expiresAt: Date.now() + BOARD_CACHE_TTL_MS });
    return locations;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Ashby can label a country-specific posting simply as `Remote` in a feed,
 * while its official job-board API exposes the postal country. Use that value
 * only as supplementary location evidence for otherwise ambiguous records.
 */
export async function enrichAshbyLocations(items: JobsFeedItem[]): Promise<JobsFeedItem[]> {
  const references = new Map<number, { board: string; jobId: string }>();
  const boards = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (!needsLocationEnrichment(item)) continue;
    const reference = parseAshbyReference(item.source_url);
    if (!reference) continue;
    references.set(index, reference);
    boards.add(reference.board);
  }
  if (references.size === 0) return items;

  const locationsByBoard = new Map<string, Map<string, unknown>>();
  const boardNames = [...boards];
  for (let start = 0; start < boardNames.length; start += BOARD_CONCURRENCY) {
    const batch = boardNames.slice(start, start + BOARD_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(async (board) => [board, await fetchBoardLocations(board)] as const));
    for (const result of results) {
      if (result.status === 'fulfilled') {
        locationsByBoard.set(result.value[0], result.value[1]);
      } else {
        console.warn('[JobsFeed] Ashby location enrichment failed:', result.reason);
      }
    }
  }

  return items.map((item, index) => {
    const reference = references.get(index);
    const officialLocation = reference ? locationsByBoard.get(reference.board)?.get(reference.jobId) : undefined;
    return officialLocation ? { ...item, official_location: officialLocation } : item;
  });
}
