import crypto from 'node:crypto';

const SCRYPT_PREFIX = 'scrypt';
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_SALT_LENGTH = 16;
const SCRYPT_MAX_MEMORY = 32 * 1024 * 1024;
const LEGACY_SALT = 'risingpath_salt';
const LEGACY_HASH_PATTERN = /^[0-9a-f]{64}$/i;

export const ADMIN_PASSWORD_MIN_LENGTH = 12;
export const ADMIN_PASSWORD_MAX_LENGTH = 256;

export interface PasswordHashVerification {
  valid: boolean;
  needsRehash: boolean;
}

function deriveScryptKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEY_LENGTH, {
      N: SCRYPT_COST,
      r: SCRYPT_BLOCK_SIZE,
      p: SCRYPT_PARALLELIZATION,
      maxmem: SCRYPT_MAX_MEMORY,
    }, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

/**
 * Store a self-describing scrypt hash so parameters can be changed safely later.
 */
export async function hashAdminPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SCRYPT_SALT_LENGTH);
  const derivedKey = await deriveScryptKey(password, salt);
  return [
    SCRYPT_PREFIX,
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

function timingSafeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function verifyScryptHash(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== SCRYPT_PREFIX) return false;

  const [, cost, blockSize, parallelization, encodedSalt, encodedKey] = parts;
  const parsedCost = Number(cost);
  const parsedBlockSize = Number(blockSize);
  const parsedParallelization = Number(parallelization);
  if (
    !Number.isSafeInteger(parsedCost) ||
    !Number.isSafeInteger(parsedBlockSize) ||
    !Number.isSafeInteger(parsedParallelization) ||
    parsedCost < 2 ||
    (parsedCost & (parsedCost - 1)) !== 0 ||
    parsedBlockSize < 1 ||
    parsedParallelization < 1 ||
    parsedCost * parsedBlockSize * parsedParallelization > SCRYPT_MAX_MEMORY / 128
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(encodedSalt, 'base64url');
    const expectedKey = Buffer.from(encodedKey, 'base64url');
    if (salt.length < 8 || expectedKey.length !== SCRYPT_KEY_LENGTH) return false;

    const actualKey = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(password, salt, expectedKey.length, {
        N: parsedCost,
        r: parsedBlockSize,
        p: parsedParallelization,
        maxmem: SCRYPT_MAX_MEMORY,
      }, (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      });
    });
    return timingSafeEqual(actualKey, expectedKey);
  } catch {
    return false;
  }
}

async function verifyLegacyHash(password: string, storedHash: string): Promise<boolean> {
  if (!LEGACY_HASH_PATTERN.test(storedHash)) return false;
  const digest = crypto.createHash('sha256').update(password + LEGACY_SALT).digest();
  return timingSafeEqual(digest, Buffer.from(storedHash, 'hex'));
}

export async function verifyAdminPasswordHash(
  password: string,
  storedHash: string,
): Promise<PasswordHashVerification> {
  if (storedHash.startsWith(`${SCRYPT_PREFIX}$`)) {
    const valid = await verifyScryptHash(password, storedHash);
    return { valid, needsRehash: false };
  }

  const valid = await verifyLegacyHash(password, storedHash);
  return { valid, needsRehash: valid };
}

export function getAdminBootstrapPassword(): string | null {
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim();
  return password
    && password.length >= ADMIN_PASSWORD_MIN_LENGTH
    && password.length <= ADMIN_PASSWORD_MAX_LENGTH
    ? password
    : null;
}

export function isAdminPasswordInput(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= ADMIN_PASSWORD_MAX_LENGTH;
}

export function isStrongAdminPasswordInput(value: unknown): value is string {
  return isAdminPasswordInput(value) && value.length >= ADMIN_PASSWORD_MIN_LENGTH;
}
