#!/usr/bin/env node
/**
 * 本机一键部署 / 回滚 liorvix 生产（调用服务器上的 liorvix-deploy）。
 *
 * 用法：
 *   pnpm run deploy:prod                 # 部署 DEPLOY_BRANCH 最新提交
 *   pnpm run deploy:prod -- <commit|tag> # 部署指定版本
 *   pnpm run deploy:prod -- --rollback <commit|tag>
 *   pnpm run deploy:prod -- --list       # 列出可回滚的构建快照
 *
 * 私钥查找顺序（第一个存在的即用，并会打印出来）：
 *   1. 环境变量 PROD_SSH_KEY
 *   2. 项目根目录 .deploy.env 里的 PROD_SSH_KEY（已 gitignore，适合长期配置）
 *   3. ./正式发布服务器密钥.pem
 *   4. ./secrets/正式发布服务器密钥.pem
 *   5. ~/.ssh/liorvix_prod
 *
 * 其他环境变量：
 *   PROD_HOST     默认 ubuntu@43.172.117.125
 *   DEPLOY_BRANCH 服务器端默认分支（见 scripts/production/deploy.sh）
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const HOST = process.env.PROD_HOST || 'ubuntu@43.172.117.125';

/** 读取项目根目录的 .deploy.env（简单 KEY=VALUE，不覆盖已有环境变量）。 */
function loadDeployEnv() {
  const file = resolve('.deploy.env');
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDeployEnv();

const KEY_CANDIDATES = [
  process.env.PROD_SSH_KEY,
  '正式发布服务器密钥.pem',
  join('secrets', '正式发布服务器密钥.pem'),
  join(homedir(), '.ssh', 'liorvix_prod'),
].filter(Boolean);

const keyPath = KEY_CANDIDATES.map((candidate) => resolve(candidate)).find((candidate) => existsSync(candidate));

if (!keyPath) {
  console.error('\n找不到生产私钥。按顺序找过：');
  for (const candidate of KEY_CANDIDATES) console.error(`  - ${resolve(candidate)}`);
  console.error('\n任选一种方式解决：');
  console.error('  a) 把「正式发布服务器密钥.pem」放到项目根目录');
  console.error('  b) 复制到 ~/.ssh/liorvix_prod');
  console.error('  c) 在项目根目录建 .deploy.env，写一行 PROD_SSH_KEY=<绝对路径>');
  console.error('  d) 临时设置环境变量 PROD_SSH_KEY=<绝对路径>\n');
  process.exit(1);
}

const args = process.argv.slice(2);
let remoteCommand;

if (args[0] === '--list') {
  remoteCommand = 'sudo /usr/local/bin/liorvix-rollback --list';
} else if (args[0] === '--rollback') {
  const ref = args[1];
  if (!ref) {
    console.error('用法: pnpm run deploy:prod -- --rollback <commit|tag>');
    process.exit(2);
  }
  remoteCommand = `sudo /usr/local/bin/liorvix-rollback ${ref}`;
} else {
  const ref = args[0] || '';
  remoteCommand = `sudo /usr/local/bin/liorvix-deploy ${ref}`.trim();
}

console.log(`> key: ${keyPath}`);
console.log(`> ${HOST}: ${remoteCommand}\n`);

const child = spawn(
  'ssh',
  [
    '-i',
    keyPath,
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=6',
    HOST,
    remoteCommand,
  ],
  { stdio: 'inherit' },
);

child.on('exit', (code, signal) => {
  if (code === 0) console.log('\n部署流程完成。');
  else if (signal) console.error(`\n部署流程被中断（signal ${signal}）。服务器日志：/var/log/liorvix-deploy/`);
  else console.error(`\n部署流程失败（exit ${code}）。服务器日志：/var/log/liorvix-deploy/`);
  process.exit(code ?? 1);
});
child.on('error', (error) => {
  console.error('无法启动 ssh：', error.message);
  process.exit(1);
});