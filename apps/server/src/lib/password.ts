import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

type ScryptAsync = (
  secret: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const scryptAsync = promisify(scrypt) as unknown as ScryptAsync;

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const PREFIX = "scrypt";

interface ScryptHash {
  n: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

async function deriveKey(
  secret: string,
  salt: Buffer,
  keyLength: number,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return await scryptAsync(secret, salt, keyLength, { N: n, r, p });
}

function encodeHash(params: ScryptHash): string {
  return [
    PREFIX,
    params.n,
    params.r,
    params.p,
    params.salt.toString("base64"),
    params.hash.toString("base64"),
  ].join("$");
}

function parseHash(stored: string): ScryptHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) {
    return null;
  }
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return null;
  }
  if (n < 1024 || n > 1048576 || r < 1 || r > 32 || p < 1 || p > 16) {
    return null;
  }
  const salt = Buffer.from(parts[4], "base64");
  const hash = Buffer.from(parts[5], "base64");
  if (salt.length === 0 || hash.length === 0) {
    return null;
  }
  return { n, r, p, salt, hash };
}

export async function hashAuthKey(authKey: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await deriveKey(
    authKey,
    salt,
    KEY_BYTES,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
  );
  return encodeHash({
    n: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    salt,
    hash,
  });
}

export async function verifyAuthKey(
  authKey: string,
  stored: string,
): Promise<boolean> {
  const parsed = parseHash(stored);
  if (parsed === null) {
    return false;
  }
  const derived = await deriveKey(
    authKey,
    parsed.salt,
    parsed.hash.length,
    parsed.n,
    parsed.r,
    parsed.p,
  );
  if (derived.length !== parsed.hash.length) {
    return false;
  }
  return timingSafeEqual(derived, parsed.hash);
}
