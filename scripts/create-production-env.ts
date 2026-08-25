import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

const projectRoot = process.cwd();
const localEnvPath = resolve(projectRoot, '.env.local');
const supabaseConfigPath = resolve(projectRoot, 'Supabase正式环境配置.txt');
const serverConfigPath = resolve(projectRoot, '最终部署美国服务器账号密码以及域名.txt');
const outputPath = resolve(projectRoot, '.env.production.local');

function getLabelValue(source: string, label: string): string | null {
  const match = source.match(new RegExp(`^\\s*${label}\\s*[:：=]\\s*(.+?)\\s*$`, 'mi'));
  return match?.[1]?.trim() || null;
}

function assertValue(value: string | null | undefined, name: string): string {
  if (!value) throw new Error(`Missing ${name} in the production configuration files.`);
  return value;
}

async function main() {
  const [localEnvSource, supabaseSource, serverSource] = await Promise.all([
    readFile(localEnvPath, 'utf8'),
    readFile(supabaseConfigPath, 'utf8'),
    readFile(serverConfigPath, 'utf8'),
  ]);
  const env = dotenv.parse(localEnvSource);

  env.NODE_ENV = 'production';
  env.HOSTNAME = '127.0.0.1';
  env.PORT = '5000';
  env.AUTH_SITE_URL = `https://${assertValue(getLabelValue(serverSource, '域名'), '域名')}`;
  env.SUPABASE_URL = assertValue(getLabelValue(supabaseSource, 'SUPABASE_URL'), 'SUPABASE_URL');
  env.SUPABASE_ANON_KEY = assertValue(
    getLabelValue(supabaseSource, 'SUPABASE_PUBLISHABLE_KEY'),
    'SUPABASE_PUBLISHABLE_KEY',
  );
  env.SUPABASE_SERVICE_ROLE_KEY = assertValue(
    getLabelValue(supabaseSource, 'SUPABASE_SECRET_KEY'),
    'SUPABASE_SECRET_KEY',
  );
  env.SUPABASE_JWKS_URL = assertValue(
    getLabelValue(supabaseSource, 'SUPABASE_JWKS_URL'),
    'SUPABASE_JWKS_URL',
  );

  const databaseUrl = assertValue(
    supabaseSource.match(/postgres(?:ql)?:\/\/[^\s"']+/iu)?.[0],
    'Supabase PostgreSQL connection string',
  );
  const poolerMatch = databaseUrl.match(/@(?<host>[^/:?]+):(?<port>\d+)\//u);
  if (!poolerMatch?.groups?.host.endsWith('.pooler.supabase.com') || poolerMatch.groups.port !== '6543') {
    throw new Error('SUPABASE_DB_URL must be the Supabase Transaction Pooler URI on port 6543.');
  }
  env.SUPABASE_DB_URL = databaseUrl;
  env.INTERVIEW_DEBUG_LOGGING = 'false';
  env.JOBS_AUTO_WORKER = 'true';

  const output = [
    '# Generated from .env.local plus production-only Supabase and domain configuration.',
    '# Do not commit this file or copy it into source control.',
    ...Object.entries(env).map(([key, value]) => `${key}=${value}`),
    '',
  ].join('\n');
  await writeFile(outputPath, output, { encoding: 'utf8', mode: 0o600 });
  console.log(`Created ${outputPath}`);
  console.log('Production APIs retain the existing local AI, TTS, ASR, and jobs-feed values.');
  console.log('SUPABASE_DB_URL is set to the Supabase Transaction Pooler URI.');
}

void main();
