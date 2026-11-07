/**
 * Runtime-agnostic WebCrypto access. @facilis/auth runs inside a browser WebContainer too,
 * so it uses the standard `globalThis.crypto` surface and never `node:crypto`.
 */

export interface SubtleCryptoLike {
  importKey(
    format: "raw",
    keyData: Uint8Array,
    algorithm: "PBKDF2",
    extractable: boolean,
    keyUsages: readonly string[],
  ): Promise<unknown>;
  deriveBits(
    algorithm: { name: "PBKDF2"; hash: "SHA-256"; salt: Uint8Array; iterations: number },
    baseKey: unknown,
    length: number,
  ): Promise<ArrayBuffer>;
  digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer>;
}

export interface WebCryptoLike {
  readonly subtle: SubtleCryptoLike;
  getRandomValues<T extends Uint8Array>(array: T): T;
}

export function webcrypto(): WebCryptoLike {
  const crypto = (globalThis as unknown as { crypto?: WebCryptoLike }).crypto;
  if (crypto === undefined) throw new Error("WebCrypto is unavailable in this runtime");
  return crypto;
}

export function randomBytes(length: number): Uint8Array {
  return webcrypto().getRandomValues(new Uint8Array(length));
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function encodeBase64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const triple = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += BASE64_ALPHABET[(triple >> 18) & 63] ?? "";
    output += BASE64_ALPHABET[(triple >> 12) & 63] ?? "";
    output += second === undefined ? "=" : (BASE64_ALPHABET[(triple >> 6) & 63] ?? "");
    output += third === undefined ? "=" : (BASE64_ALPHABET[triple & 63] ?? "");
  }
  return output;
}

export function decodeBase64(value: string): Uint8Array | null {
  if (value.length % 4 !== 0) return null;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const bytes: number[] = [];

  for (let index = 0; index < value.length; index += 4) {
    const chunk = value.slice(index, index + 4);
    const symbols = [...chunk].map((character, offset) => {
      if (character === "=" && offset >= 4 - padding) return 0;
      return BASE64_ALPHABET.indexOf(character);
    });
    if (symbols.some((symbol) => symbol < 0)) return null;
    const [first = 0, second = 0, third = 0, fourth = 0] = symbols;
    const triple = (first << 18) | (second << 12) | (third << 6) | fourth;
    bytes.push((triple >> 16) & 255, (triple >> 8) & 255, triple & 255);
  }

  const paddingBytes = padding === 0 ? [] : bytes.slice(-padding);
  if (paddingBytes.some((byte) => byte !== 0)) return null;
  return new Uint8Array(padding === 0 ? bytes : bytes.slice(0, -padding));
}

/** URL-safe random token (cookie-friendly, no padding). */
export function randomToken(byteLength: number): string {
  return encodeBase64(randomBytes(byteLength))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/**
 * SHA-256 of a string as lowercase hex. WebCrypto only, so the session-hash path also runs
 * inside the browser WebContainer; the raw value is never stored or logged.
 */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await webcrypto().subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compares secrets without leaking the index of the first mismatch. */
export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}
