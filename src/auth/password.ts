import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [algorithm, salt, stored] = encoded.split(':');
  if (algorithm !== 'scrypt' || !salt || !stored) return false;
  const candidate = scryptSync(password, salt, KEY_LENGTH);
  const storedBuffer = Buffer.from(stored, 'hex');
  return storedBuffer.length === candidate.length && timingSafeEqual(storedBuffer, candidate);
}

export function createSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createCsrfToken(): string {
  return randomBytes(24).toString('base64url');
}
