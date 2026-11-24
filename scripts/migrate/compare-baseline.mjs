#!/usr/bin/env node
/**
 * 对比「迁移前基线」与「迁移后快照」，按危害分级退出（P4 验收）。
 *
 *   node scripts/migrate/compare-baseline.mjs \
 *     --baseline=docs/baseline/prod-before-2026-11-20.json \
 *     --after=docs/baseline/after.json
 *
 * 分级规则：
 *   FAIL  基线里有、快照里没有的键（丢了对象/表）；数据行数或结构对象数**减少**；
 *         schema 版本 / 扩展集合 / bucket 配置变化。
 *   WARN  数据库体积、序列、活跃/关闭岗位数等随业务自然变化的值。
 *   OK    完全一致。
 *
 * 为什么不做"数值一律不能变"：迁移窗口内仍可能有登录（auth 访问）、定时任务等写入，
 * 行数只增是正常的；真正危险的是**减少**和**结构缺失**。
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const arg = (name) => args.find((a) => a.startsWith(`${name}=`))?.split('=').slice(1).join('=');
const baselinePath = arg('--baseline');
const afterPath = arg('--after');
if (!baselinePath || !afterPath) {
  console.error('usage: compare-baseline.mjs --baseline=<file> --after=<file>');
  process.exit(2);
}

const read = (file) => {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return parsed.items ?? parsed;
};

/** 把嵌套对象摊平成 `a.b.c`，与非对象值一起放进同一个 map。 */
function flatten(value, prefix = '', out = new Map()) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  out.set(prefix, value);
  return out;
}

const baseline = flatten(read(baselinePath));
const after = flatten(read(afterPath));

// 结构类键：只要变化就必须人工确认
const STRUCTURAL = [
  'publicTables',
  'publicViews',
  'publicFunctions',
  'rlsPolicies',
  'triggers',
  'sequences',
  'schemas',
  'extensions',
  'authMaxSchemaMigration',
  'authSchemaMigrationCount',
  'migrationHistoryMax',
  'storageBucketConfig',
];
// 随业务自然变化、只记录不阻塞
const INFORMATIONAL = ['databaseSize', 'databaseSizeBytes', 'jobsActive', 'oldDomainRefs', 'target'];

const isStructural = (key) => STRUCTURAL.some((p) => key === p || key.startsWith(`${p}.`));
const isInformational = (key) => INFORMATIONAL.some((p) => key === p || key.startsWith(`${p}.`));

const toNumber = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/u.test(value.trim())) return Number(value);
  return null;
};

const fails = [];
const warns = [];
const bucketAdded = [];
let same = 0;

/**
 * storageByBucket 是 [{bucket, objects, bytes}]，直接按 JSON 比对会把"迁移窗口内又有新简历上传"
 * 判成 FAIL（实测：risingpath-resumes 18 → 20）。桶内对象只增不减才是安全方向，
 * 因此单独处理：桶消失或对象数减少 → FAIL；增加 → WARN。
 */
function parseBuckets(value) {
  if (!Array.isArray(value)) return null;
  const out = new Map();
  for (const item of value) {
    if (item && typeof item === 'object' && 'bucket' in item) out.set(String(item.bucket), item);
  }
  return out;
}

const baselineBuckets = parseBuckets(baseline.get('storageByBucket'));
const afterBuckets = parseBuckets(after.get('storageByBucket'));
if (baselineBuckets && afterBuckets) {
  baseline.delete('storageByBucket');
  after.delete('storageByBucket');
  for (const [bucket, item] of baselineBuckets) {
    const now = afterBuckets.get(bucket);
    if (!now) {
      fails.push(`storageByBucket.${bucket}: 桶缺失（基线 objects=${item.objects}）`);
      continue;
    }
    const beforeObjects = toNumber(item.objects) ?? 0;
    const nowObjects = toNumber(now.objects) ?? 0;
    if (nowObjects < beforeObjects) {
      fails.push(`storageByBucket.${bucket}.objects: ${beforeObjects} -> ${nowObjects} (DECREASED)`);
    } else if (nowObjects > beforeObjects) {
      warns.push(`storageByBucket.${bucket}.objects: ${beforeObjects} -> ${nowObjects}`);
    } else {
      same += 1;
    }
  }
  for (const bucket of afterBuckets.keys()) {
    if (!baselineBuckets.has(bucket)) bucketAdded.push(`storageByBucket.${bucket}`);
  }
}

for (const [key, before] of baseline) {
  if (!after.has(key)) {
    fails.push(`${key}: 缺失（基线 ${JSON.stringify(before)}）`);
    continue;
  }
  const now = after.get(key);
  // extensions 在快照里是数组；自托管镜像会自带 Cloud 上没有的扩展（VPS 实测：citext），
  // 只要基线的扩展一个不缺就算保真（超集 = 多能力），多出来的只记 WARN。
  if (key === 'extensions' && Array.isArray(before) && Array.isArray(now)) {
    const names = (list) => list.map((item) => String(item).split(/\s+/u)[0]).sort();
    const expected = names(before);
    const actual = names(now);
    const missing = expected.filter((name) => !actual.includes(name));
    const extra = actual.filter((name) => !expected.includes(name));
    if (missing.length) fails.push(`extensions: 缺少 ${missing.join(',')}`);
    else if (extra.length) warns.push(`extensions: 多出 ${extra.join(',')}（自托管镜像自带，无碍）`);
    else same += 1;
    continue;
  }
  const beforeNumber = toNumber(before);
  const nowNumber = toNumber(now);

  if (beforeNumber !== null && nowNumber !== null) {
    if (nowNumber === beforeNumber) { same += 1; continue; }
    const decreased = nowNumber < beforeNumber;
    const label = `${key}: ${beforeNumber} -> ${nowNumber}${decreased ? ' (DECREASED)' : ''}`;
    if (isInformational(key)) warns.push(label);
    else if (decreased || isStructural(key)) fails.push(label);
    else warns.push(label);
    continue;
  }

  if (JSON.stringify(before) === JSON.stringify(now)) { same += 1; continue; }
  const label = `${key}: ${JSON.stringify(before)} -> ${JSON.stringify(now)}`;
  if (isInformational(key)) warns.push(label);
  else fails.push(label);
}

// 快照里多出来的键：通常是无害的（新表/新扩展），只提示
const added = [...after.keys()].filter((key) => !baseline.has(key)).concat(bucketAdded);

console.log(`baseline: ${baselinePath}`);
console.log(`after:    ${afterPath}`);
console.log(`keys: ${baseline.size} baseline / ${after.size} after; identical ${same}`);
if (warns.length) {
  console.log(`\nWARN (${warns.length}) — 预期内变化，人工确认即可`);
  for (const line of warns) console.log(`  ~ ${line}`);
}
if (added.length) {
  console.log(`\nINFO (${added.length}) — 快照中新增的键`);
  for (const key of added.slice(0, 20)) console.log(`  + ${key} = ${JSON.stringify(after.get(key))}`);
}
if (fails.length) {
  console.log(`\nFAIL (${fails.length}) — 不允许，先查清再切换`);
  for (const line of fails) console.log(`  ! ${line}`);
  process.exit(1);
}
console.log('\n结论：没有丢数据或结构变化，可以继续切换流程。');