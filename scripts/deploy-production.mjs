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
 * 环境变量：
 *   PROD_HOST     默认 ubuntu@43.172.117.125
 *   PROD_SSH_KEY  生产私钥路径；默认 ./正式发布服务器密钥.pem
 *   DEPLOY_BRANCH 服务器端默认分支（见 scripts/production/deploy.sh）
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const HOST = process.env.PROD_HOST || 'ubuntu@43.172.117.125';
const KEY = resolve(process.env.PROD_SSH_KEY || '正式发布服务器密钥.pem');

if (!existsSync(KEY)) {
  console.error(`\n找不到生产私钥：${KEY}`);
  console.error('把「正式发布服务器密钥.pem」放到项目根目录，或设置 PROD_SSH_KEY 指向它。\n');
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

console.log(`> ${HOST}: ${remoteCommand}\n`);

const child = spawn(
  'ssh',
  ['-i', KEY, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', HOST, remoteCommand],
  { stdio: 'inherit' },
);

child.on('exit', (code) => {
  if (code === 0) console.log('\n部署流程完成。');
  else console.error(`\n部署流程失败（exit ${code}）。服务器上有完整日志：/var/log/liorvix-deploy/`);
  process.exit(code ?? 1);
});
child.on('error', (error) => {
  console.error('无法启动 ssh：', error.message);
  process.exit(1);
});