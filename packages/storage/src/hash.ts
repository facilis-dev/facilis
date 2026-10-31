import { createHash } from "node:crypto";

/**
 * Content address of a blob: the sha-256 hex digest.
 *
 * Every driver keys storage by this value, so identical bytes are stored once and the
 * database row is the only per-upload state. Lowercase hex, 64 characters.
 */
export function contentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Whether a string is a content hash this package produced. Guards path/URL building. */
export function isContentHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}
