#!/usr/bin/env node
/**
 * 把 Supabase Storage 的对象从旧项目复制到自托管实例（P3 演练 / §7）。
 *
 *   # 只盘点（不写任何东西，可直接对生产跑）
 *   SOURCE_SUPABASE_URL=... SOURCE_SERVICE_ROLE_KEY=... \
 *     node scripts/migrate/migrate-storage-objects.mjs --list-only
 *
 *   # 真正复制（先在演练环境跑）
 *   SOURCE_SUPABASE_URL=... SOURCE_SERVICE_ROLE_KEY=... \
 *   TARGET_SUPABASE_URL=... TARGET_SERVICE_ROLE_KEY=... \
 *     node scripts/migrate/migrate-storage-objects.mjs --apply
 *
 * 设计：
 *   * 默认 dry-run，只有 --apply 才写；
 *   * 目标已存在且大小一致的对象默认跳过（--force 覆盖）；
 *   * 先按源端 bucket 的 public 属性建桶（storage API 的桶元数据不随 dump 迁移）；
 *   * 失败不静默：任何一个对象失败都会以非 0 退出，并列出失败清单；
 *   * 并发 4，足够快又不会把 Cloud 出口打满。
 */
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const LIST_ONLY = args.includes('--list-only');
const FORCE = args.includes('--force');
const CONCURRENCY = Number(args.find((a) => a.startsWith('--concurrency='))?.split('=')[1] || 4);

const SOURCE_URL = (process.env.SOURCE_SUPABASE_URL || '').replace(/\/+$/u, '');
const SOURCE_KEY = process.env.SOURCE_SERVICE_ROLE_KEY || '';
const TARGET_URL = (process.env.TARGET_SUPABASE_URL || '').replace(/\/+$/u, '');
const TARGET_KEY = process.env.TARGET_SERVICE_ROLE_KEY || '';

if (!SOURCE_URL || !SOURCE_KEY) {
  console.error('SOURCE_SUPABASE_URL / SOURCE_SERVICE_ROLE_KEY are required');
  process.exit(2);
}
if (!LIST_ONLY && (!TARGET_URL || !TARGET_KEY)) {
  console.error('TARGET_SUPABASE_URL / TARGET_SERVICE_ROLE_KEY are required unless --list-only');
  process.exit(2);
}

const headers = (key) => ({ apikey: key, Authorization: `Bearer ${key}` });

async function api(base, key, path, init = {}) {
  const response = await fetch(`${base}/storage/v1${path}`, {
    ...init,
    headers: { ...headers(key), ...(init.headers || {}) },
  });
  return response;
}

const encodeKey = (key) => key.split('/').map(encodeURIComponent).join('/');

async function listBuckets(base, key) {
  const response = await api(base, key, '/bucket');
  if (!response.ok) throw new Error(`list buckets failed: HTTP ${response.status} ${await response.text()}`);
  return response.json();
}

/** 递归列出 bucket 下所有对象（storage 的 list 只列一层，文件夹的 id 为 null）。 */
async function listObjects(base, key, bucket, prefix = '', out = []) {
  let offset = 0;
  for (;;) {
    const response = await api(base, key, `/object/list/${encodeURIComponent(bucket)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!response.ok) throw new Error(`list ${bucket}/${prefix} failed: HTTP ${response.status} ${await response.text()}`);
    const rows = await response.json();
    if (!rows.length) return out;
    for (const row of rows) {
      const name = row.name;
      const full = prefix ? `${prefix}/${name}` : name;
      if (row.id === null || row.metadata === null) {
        await listObjects(base, key, bucket, full, out);
      } else {
        out.push({
          key: full,
          size: Number(row.metadata?.size ?? 0),
          contentType: row.metadata?.mimetype || 'application/octet-stream',
        });
      }
    }
    offset += rows.length;
    if (rows.length < 100) return out;
  }
}

async function createBucketIfMissing(bucket) {
  const response = await api(TARGET_URL, TARGET_KEY, '/bucket', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: bucket.id,
      name: bucket.name,
      public: Boolean(bucket.public),
      file_size_limit: bucket.file_size_limit ?? null,
      allowed_mime_types: bucket.allowed_mime_types ?? null,
    }),
  });
  if (response.ok) return 'created';
  const text = await response.text();
  if (/already exists|Duplicate/iu.test(text)) return 'exists';
  throw new Error(`create bucket ${bucket.id} failed: HTTP ${response.status} ${text}`);
}

async function targetObjectSize(bucket, key) {
  // 用 HEAD 而不是 /object/info（后者在不同 storage-api 版本里路径不完全一致）
  const response = await api(TARGET_URL, TARGET_KEY, `/object/${encodeURIComponent(bucket)}/${encodeKey(key)}`, {
    method: 'HEAD',
  });
  if (!response.ok) return null;
  const size = Number(response.headers.get('content-length'));
  return Number.isFinite(size) ? size : null;
}

async function copyOne(bucket, object, stats) {
  if (!FORCE) {
    const existing = await targetObjectSize(bucket, object.key);
    if (existing === object.size) {
      stats.skipped += 1;
      return;
    }
  }
  const download = await api(SOURCE_URL, SOURCE_KEY, `/object/${encodeURIComponent(bucket)}/${encodeKey(object.key)}`);
  if (!download.ok) throw new Error(`download ${bucket}/${object.key}: HTTP ${download.status}`);
  const buffer = Buffer.from(await download.arrayBuffer());
  const expectedHash = createHash('sha256').update(buffer).digest('hex');

  const upload = await api(TARGET_URL, TARGET_KEY, `/object/${encodeURIComponent(bucket)}/${encodeKey(object.key)}`, {
    method: 'POST',
    headers: { 'content-type': object.contentType, 'x-upsert': 'true' },
    body: buffer,
  });
  if (!upload.ok) throw new Error(`upload ${bucket}/${object.key}: HTTP ${upload.status} ${await upload.text()}`);

  const uploadedSize = await targetObjectSize(bucket, object.key);
  if (uploadedSize !== buffer.length) {
    throw new Error(`size mismatch after upload ${bucket}/${object.key}: source ${buffer.length}, target ${uploadedSize}`);
  }
  stats.copied += 1;
  stats.bytes += buffer.length;
  console.log(`  copied ${bucket}/${object.key} (${buffer.length} B, sha256 ${expectedHash.slice(0, 12)}…)`);
}

const pool = async (items, limit, worker) => {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(workers);
};

async function main() {
  console.log(`source: ${SOURCE_URL}`);
  console.log(`target: ${LIST_ONLY ? '(list-only, no target)' : TARGET_URL}`);
  console.log(`mode:   ${LIST_ONLY ? 'list-only' : APPLY ? 'apply' : 'dry-run'}`);

  const buckets = await listBuckets(SOURCE_URL, SOURCE_KEY);
  console.log(`buckets: ${buckets.length} -> ${buckets.map((b) => `${b.id}(${b.public ? 'public' : 'private'})`).join(', ')}`);

  const objects = [];
  for (const bucket of buckets) {
    const list = await listObjects(SOURCE_URL, SOURCE_KEY, bucket.id);
    console.log(`  ${bucket.id}: ${list.length} objects, ${(list.reduce((sum, o) => sum + o.size, 0) / 1024 / 1024).toFixed(2)} MB`);
    objects.push(...list.map((object) => ({ bucket: bucket.id, ...object })));
  }
  console.log(`total: ${objects.length} objects, ${(objects.reduce((sum, o) => sum + o.size, 0) / 1024 / 1024).toFixed(2)} MB`);

  if (LIST_ONLY) {
    const suspicious = objects.filter((o) => o.key.startsWith('.smoke/'));
    console.log(`list-only done; ${suspicious.length} smoke probe object(s) present`);
    return;
  }

  const missingBuckets = [];
  for (const bucket of buckets) {
    const result = await createBucketIfMissing(bucket);
    console.log(`bucket ${bucket.id}: ${result}`);
    if (result === 'created') missingBuckets.push(bucket.id);
  }

  if (!APPLY) {
    console.log('\ndry-run: no object was copied. Re-run with --apply to copy.');
    console.log(`would copy ${objects.length} objects (${(objects.reduce((sum, o) => sum + o.size, 0) / 1024 / 1024).toFixed(2)} MB)`);
    return;
  }

  const stats = { copied: 0, skipped: 0, bytes: 0 };
  const failures = [];
  await pool(objects, CONCURRENCY, async (object) => {
    try {
      await copyOne(object.bucket, object, stats);
    } catch (error) {
      failures.push({ ...object, error: error instanceof Error ? error.message : String(error) });
    }
  });

  console.log(`\ncopied ${stats.copied} (${(stats.bytes / 1024 / 1024).toFixed(2)} MB), skipped ${stats.skipped}, failed ${failures.length}`);
  if (failures.length) {
    for (const failure of failures) console.error(`  FAIL ${failure.bucket}/${failure.key}: ${failure.error}`);
    process.exit(1);
  }

  // 最终对账：目标端每个 bucket 的对象数与源端一致
  let mismatch = 0;
  for (const bucket of buckets) {
    const sourceList = objects.filter((o) => o.bucket === bucket.id);
    const targetList = await listObjects(TARGET_URL, TARGET_KEY, bucket.id);
    const state = sourceList.length === targetList.length ? 'ok' : 'MISMATCH';
    if (state === 'MISMATCH') mismatch += 1;
    console.log(`verify ${bucket.id}: source ${sourceList.length} / target ${targetList.length} ${state}`);
  }
  if (mismatch) {
    console.error('object count mismatch, refusing to report success');
    process.exit(1);
  }
  console.log('storage migration verified: object counts match');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});