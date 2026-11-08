import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { StreamReader } from "./stream-reader.ts";
import { StorageError } from "./types.ts";

/**
 * The encrypted-blob format (D-117), shared by the streaming encryptor and decryptor.
 *
 * Layout, version 1:
 *   magic "FACILIS1" | version (u8) | keyIdLen (u8) | keyId | chunkSize (u32 BE)
 *   | wrap nonce (12) | wrapped DEK (32 + 16 tag)
 *   | chunk*: nonce (12) | ciphertext (1..chunkSize) | tag (16)
 *
 * The DEK is wrapped with the KEK and the AAD binds the whole header prefix (version, key
 * id, chunk size); each chunk AAD binds the full header, its index and a final flag, so
 * truncation, reordering and header edits all fail authentication. There is no plaintext
 * length in the header: the final flag is what tells the reader where the blob ends, which
 * keeps the encryptor streaming without knowing the size up front.
 */

const MAGIC = Buffer.from("FACILIS1", "ascii");
const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const WRAPPED_KEY_BYTES = KEY_BYTES + TAG_BYTES;
const KEY_ID_MAX_LENGTH = 64;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const HEADER_PREFIX_BYTES = MAGIC.length + 2;

/** Chunk size of the authenticated encryption stream. 1 MiB bounds memory per chunk. */
export const STORAGE_ENCRYPTION_CHUNK_BYTES = 1024 * 1024;
/** Nonce plus tag overhead of one framed chunk. */
export const STORAGE_ENCRYPTION_CHUNK_OVERHEAD = NONCE_BYTES + TAG_BYTES;

export interface StorageEncryptionKeys {
  readonly activeKeyId: string;
  readonly keys: Readonly<Record<string, Uint8Array>>;
}

export interface OpenedHeader {
  readonly header: Buffer;
  readonly dek: Buffer;
  readonly chunkSize: number;
}

export function isValidEncryptionKeyId(value: string): boolean {
  return KEY_ID_PATTERN.test(value);
}

/** Whether the bytes start with the encrypted-blob magic (a cheap pre-check). */
export function isEncryptedBlob(bytes: Uint8Array): boolean {
  return bytes.length >= MAGIC.length && Buffer.from(bytes.subarray(0, MAGIC.length)).equals(MAGIC);
}

export function sealHeader(keys: StorageEncryptionKeys): { header: Buffer; dek: Buffer } {
  const keyId = keys.activeKeyId;
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new StorageError("storage encryption: invalid active key id");
  }
  const kek = keyFor(keys, keyId);
  const keyIdBytes = Buffer.from(keyId, "ascii");
  const prefix = Buffer.concat([
    MAGIC,
    Buffer.from([VERSION, keyIdBytes.length]),
    keyIdBytes,
    u32(STORAGE_ENCRYPTION_CHUNK_BYTES),
  ]);
  const dek = randomBytes(KEY_BYTES);
  const wrapNonce = randomBytes(NONCE_BYTES);
  const wrap = createCipheriv("aes-256-gcm", kek, wrapNonce);
  wrap.setAAD(prefix);
  const wrappedKey = Buffer.concat([wrap.update(dek), wrap.final(), wrap.getAuthTag()]);
  return { header: Buffer.concat([prefix, wrapNonce, wrappedKey]), dek };
}

export async function openHeader(
  reader: StreamReader,
  keys: StorageEncryptionKeys,
): Promise<OpenedHeader> {
  const base = await reader.readExactly(HEADER_PREFIX_BYTES);
  if (!isEncryptedBlob(base)) {
    throw new StorageError("storage encryption: blob is not encrypted (re-upload it)");
  }
  const version = base[MAGIC.length] ?? -1;
  if (version !== VERSION) {
    throw new StorageError("storage encryption: unsupported blob version");
  }
  const keyIdLength = base[MAGIC.length + 1] ?? 0;
  if (keyIdLength === 0 || keyIdLength > KEY_ID_MAX_LENGTH) {
    throw new StorageError("storage encryption: malformed blob header");
  }
  const keyIdBytes = await reader.readExactly(keyIdLength);
  const chunkSizeBytes = await reader.readExactly(4);
  const prefix = Buffer.concat([base, keyIdBytes, chunkSizeBytes]);
  const chunkSize = prefix.readUInt32BE(HEADER_PREFIX_BYTES + keyIdLength);
  if (chunkSize !== STORAGE_ENCRYPTION_CHUNK_BYTES) {
    throw new StorageError("storage encryption: unsupported chunk size in blob header");
  }
  const keyId = keyIdBytes.toString("ascii");
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new StorageError("storage encryption: unknown key id in blob header");
  }
  const wrapNonce = await reader.readExactly(NONCE_BYTES);
  const wrappedKey = await reader.readExactly(WRAPPED_KEY_BYTES);
  const header = Buffer.concat([prefix, wrapNonce, wrappedKey]);
  const kek = keyFor(keys, keyId);

  let dek: Buffer;
  try {
    const unwrap = createDecipheriv("aes-256-gcm", kek, wrapNonce);
    unwrap.setAAD(prefix);
    unwrap.setAuthTag(wrappedKey.subarray(KEY_BYTES));
    dek = Buffer.concat([unwrap.update(wrappedKey.subarray(0, KEY_BYTES)), unwrap.final()]);
  } catch {
    throw new StorageError("storage encryption: wrapped key failed authentication");
  }
  return { header, dek, chunkSize };
}

export function sealChunk(
  dek: Buffer,
  header: Buffer,
  index: number,
  final: boolean,
  data: Uint8Array,
): Uint8Array {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", dek, nonce);
  cipher.setAAD(chunkAad(header, index, final));
  return Buffer.concat([nonce, cipher.update(data), cipher.final(), cipher.getAuthTag()]);
}

export function openChunk(
  dek: Buffer,
  header: Buffer,
  index: number,
  final: boolean,
  data: Buffer,
): Uint8Array {
  const nonce = data.subarray(0, NONCE_BYTES);
  const body = data.subarray(NONCE_BYTES, data.length - TAG_BYTES);
  const tag = data.subarray(data.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", dek, nonce);
  decipher.setAAD(chunkAad(header, index, final));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new StorageError("storage encryption: blob failed authentication");
  }
}

export function wipeKey(key: Buffer): void {
  key.fill(0);
}

function chunkAad(header: Buffer, index: number, final: boolean): Buffer {
  return Buffer.concat([header, u32(index), Buffer.from([final ? 1 : 0])]);
}

function keyFor(keys: StorageEncryptionKeys, keyId: string): Buffer {
  // Own-property lookup: the key id comes from config/header, and a record prototype
  // (such as __proto__) must never be mistaken for key material.
  const key = Object.hasOwn(keys.keys, keyId) ? keys.keys[keyId] : undefined;
  if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) {
    throw new StorageError('storage encryption: key "' + keyId + '" is missing or not 32 bytes');
  }
  return Buffer.from(key);
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}
