#!/usr/bin/env node
/**
 * Generates the self-hosted Supabase secrets for /opt/supabase/.env.
 *
 *   node scripts/migrate/generate-selfhost-secrets.mjs            # print, no writes
 *   node scripts/migrate/generate-selfhost-secrets.mjs --write deploy/supabase/.env
 *
 * The stack in deploy/supabase/docker-compose.yml signs with a single HS256
 * secret (GOTRUE_JWT_SECRET = PGRST_JWT_SECRET = AUTH_JWT_SECRET). The anon and
 * service_role keys are therefore ordinary JWTs signed with that secret, which is
 * what supabase-js passes verbatim as both `apikey` and `Authorization: Bearer`.
 *
 * Values are generated locally with node:crypto — no network, no dependencies.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const templatePath = resolve(here, '../../deploy/supabase/.env.example');

const args = process.argv.slice(2);
const writeIndex = args.indexOf('--write');
const writePath = writeIndex >= 0 ? args[writeIndex + 1] : null;

const base64url = (value) => Buffer.from(value).toString('base64url');

function signJwt(payload, secret) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

const secret = randomBytes(32).toString('base64url');
const postgresPassword = randomBytes(24).toString('base64url');
const imgproxyKey = randomBytes(16).toString('hex');
const imgproxySalt = randomBytes(16).toString('hex');

// 10 years — the keys are meant to outlive individual deployments, and rotating
// them is a deliberate migration step, not a routine one.
const issuedAt = Math.floor(Date.now() / 1000);
const expiresAt = issuedAt + 10 * 365 * 24 * 3600;

const anonKey = signJwt({ role: 'anon', iss: 'supabase', iat: issuedAt, exp: expiresAt }, secret);
const serviceRoleKey = signJwt(
  { role: 'service_role', iss: 'supabase', iat: issuedAt, exp: expiresAt },
  secret,
);

function verify(jwt, expectedRole) {
  const [header, body, signature] = jwt.split('.');
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  if (expected !== signature) throw new Error('self-check failed: signature mismatch');
  const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
  const parsedBody = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (parsedHeader.alg !== 'HS256') throw new Error('self-check failed: unexpected alg');
  if (parsedBody.role !== expectedRole) throw new Error('self-check failed: unexpected role');
}

verify(anonKey, 'anon');
verify(serviceRoleKey, 'service_role');

const generated = {
  JWT_SECRET: secret,
  POSTGRES_PASSWORD: postgresPassword,
  ANON_KEY: anonKey,
  SERVICE_ROLE_KEY: serviceRoleKey,
  IMGPROXY_KEY: imgproxyKey,
  IMGPROXY_SALT: imgproxySalt,
};

if (!writePath) {
  for (const [key, value] of Object.entries(generated)) console.log(`${key}=${value}`);
  process.exit(0);
}

if (existsSync(writePath) && !args.includes('--force')) {
  const existing = readFileSync(writePath, 'utf8');
  if (/^JWT_SECRET=\S+/mu.test(existing)) {
    console.error(
      `refusing to overwrite ${writePath}: it already has a JWT_SECRET.\n`
      + 'Rotating these values invalidates every issued token and the storage imgproxy signatures.\n'
      + 'Pass --force only if you really mean to rotate them.',
    );
    process.exit(1);
  }
}

const template = existsSync(writePath)
  ? readFileSync(writePath, 'utf8')
  : readFileSync(templatePath, 'utf8');

let rendered = template;
for (const [key, value] of Object.entries(generated)) {
  const pattern = new RegExp(`^${key}=.*$`, 'mu');
  rendered = pattern.test(rendered)
    ? rendered.replace(pattern, `${key}=${value}`)
    : `${rendered.trimEnd()}\n${key}=${value}\n`;
}

if (process.platform === 'win32') {
  rendered = rendered.replace(/\r\n/g, '\n');
}
writeFileSync(writePath, rendered, { encoding: 'utf8', mode: 0o600 });
console.log(`wrote ${writePath} (chmod 600)`);
for (const key of ['JWT_SECRET', 'POSTGRES_PASSWORD', 'ANON_KEY', 'SERVICE_ROLE_KEY']) {
  const value = rendered.match(new RegExp(`^${key}=(.*)$`, 'mu'))?.[1] ?? '';
  console.log(`${key}: ${value ? `${value.slice(0, 12)}… (${value.length} chars)` : 'MISSING'}`);
}