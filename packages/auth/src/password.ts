import { constantTimeEqual, decodeBase64, encodeBase64, randomBytes, webcrypto } from "./crypto.ts";

const ALGORITHM = "pbkdf2-sha256";
const DEFAULT_ITERATIONS = 600_000;
const MAX_ITERATIONS = 1_000_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const KEY_BYTES = KEY_BITS / 8;

/**
 * Hashes a password with PBKDF2-SHA256 (WebCrypto). Encoding is versioned and
 * self-describing: `pbkdf2-sha256$<iterations>$<saltB64>$<hashB64>`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await deriveKey(password, salt, DEFAULT_ITERATIONS);
  return [ALGORITHM, String(DEFAULT_ITERATIONS), encodeBase64(salt), encodeBase64(hash)].join("$");
}

/** Constant-time verification; malformed or unsupported hashes return false, never throw. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const parsed = parsePasswordHash(hash);
  if (parsed === null) return false;
  const candidate = await deriveKey(password, parsed.salt, parsed.iterations);
  return constantTimeEqual(candidate, parsed.hash);
}

interface ParsedPasswordHash {
  iterations: number;
  salt: Uint8Array;
  hash: Uint8Array;
}

function parsePasswordHash(value: string): ParsedPasswordHash | null {
  const parts = value.split("$");
  if (parts.length !== 4) return null;
  const [algorithm, iterationsText, saltText, hashText] = parts;
  if (
    algorithm !== ALGORITHM ||
    iterationsText === undefined ||
    saltText === undefined ||
    hashText === undefined ||
    !/^[1-9][0-9]*$/.test(iterationsText)
  ) {
    return null;
  }

  const iterations = Number(iterationsText);
  if (iterations > MAX_ITERATIONS) return null;

  const salt = decodeBase64(saltText);
  const hash = decodeBase64(hashText);
  if (salt === null || hash === null || salt.length !== SALT_BYTES || hash.length !== KEY_BYTES) {
    return null;
  }
  return { iterations, salt, hash };
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const { subtle } = webcrypto();
  const key = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}
