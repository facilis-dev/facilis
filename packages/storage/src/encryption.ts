import {
  openChunk,
  openHeader,
  sealChunk,
  sealHeader,
  STORAGE_ENCRYPTION_CHUNK_BYTES,
  STORAGE_ENCRYPTION_CHUNK_OVERHEAD,
  wipeKey,
  type StorageEncryptionKeys,
} from "./encryption-format.ts";
import { StreamReader } from "./stream-reader.ts";
import { StorageError } from "./types.ts";

export type { StorageEncryptionKeys } from "./encryption-format.ts";
export {
  isEncryptedBlob,
  isValidEncryptionKeyId,
  STORAGE_ENCRYPTION_CHUNK_BYTES,
} from "./encryption-format.ts";

/**
 * Encrypt a byte source as a stream (D-117).
 *
 * The output starts with the self-describing header, then framed AES-256-GCM chunks of up
 * to 1 MiB. A chunk is held back until the next input arrives, because only then is it
 * known whether it is the final chunk (the final flag is authenticated). An empty plaintext
 * still gets one empty final frame, so "header only" can only mean truncation and never a
 * valid empty file. Memory stays at one chunk, not one file.
 */
export async function* encryptStream(
  source: AsyncIterable<Uint8Array>,
  keys: StorageEncryptionKeys,
): AsyncGenerator<Uint8Array> {
  const { header, dek } = sealHeader(keys);
  try {
    yield header;
    const buffer = Buffer.allocUnsafe(STORAGE_ENCRYPTION_CHUNK_BYTES);
    let filled = 0;
    let full = false;
    let index = 0;
    for await (const part of source) {
      let offset = 0;
      while (offset < part.length) {
        if (full) {
          yield sealChunk(dek, header, index, false, buffer.subarray(0, filled));
          index += 1;
          filled = 0;
          full = false;
        }
        const take = Math.min(buffer.length - filled, part.length - offset);
        buffer.set(part.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === buffer.length) full = true;
      }
    }
    yield sealChunk(dek, header, index, true, buffer.subarray(0, filled));
  } finally {
    wipeKey(dek);
  }
}

/**
 * Decrypt a stored blob as a stream (D-117), the inverse of encryptStream.
 *
 * The reader keeps one full chunk pending to know whether the next bytes exist, which is
 * how the final flag is established without a plaintext length in the header. Truncation,
 * reordering, duplication and appended bytes all fail authentication.
 */
export function decryptStream(
  source: AsyncIterable<Uint8Array>,
  keys: StorageEncryptionKeys,
): AsyncIterable<Uint8Array> {
  return (async function* decrypt(): AsyncGenerator<Uint8Array> {
    yield* await openEncryptedStream(source, keys);
  })();
}

/**
 * Validate the header and the first frame before the caller commits a response (D-117).
 *
 * encryptStream/decryptStream validate lazily, which is right for a pipeline but wrong for
 * a download: once the Response is built the status line is already sent. The storage
 * wrapper calls this first, so a plaintext legacy blob, an unknown key id, a corrupt header
 * or a blob truncated to its header is a normal 500 instead of a 200 whose body aborts.
 * Later chunks stay streaming, so a mid-body tamper still fails while the bytes are read.
 */
export async function openEncryptedStream(
  source: AsyncIterable<Uint8Array>,
  keys: StorageEncryptionKeys,
): Promise<AsyncIterable<Uint8Array>> {
  const reader = new StreamReader(source);
  const { header, dek, chunkSize } = await openHeader(reader, keys);
  const frame = chunkSize + STORAGE_ENCRYPTION_CHUNK_OVERHEAD;
  const first = await reader.readAtMost(frame);
  if (first.length === 0) {
    throw new StorageError("storage encryption: truncated blob (no chunks)");
  }
  return decryptBody(reader, header, dek, chunkSize, first);
}

async function* decryptBody(
  reader: StreamReader,
  header: Buffer,
  dek: Buffer,
  chunkSize: number,
  first: Buffer,
): AsyncGenerator<Uint8Array> {
  const frame = chunkSize + STORAGE_ENCRYPTION_CHUNK_OVERHEAD;
  let buffered: Buffer | null = first;
  let pending: Buffer | null = null;
  let index = 0;
  try {
    for (;;) {
      const data = buffered ?? (await reader.readAtMost(frame));
      buffered = null;
      if (data.length === 0) {
        if (pending !== null) {
          yield openChunk(dek, header, index, true, pending);
          break;
        }
        throw new StorageError("storage encryption: truncated blob");
      }
      if (data.length < STORAGE_ENCRYPTION_CHUNK_OVERHEAD) {
        throw new StorageError("storage encryption: malformed chunk");
      }
      if (data.length < frame) {
        if (pending !== null) {
          yield openChunk(dek, header, index, false, pending);
          index += 1;
        }
        yield openChunk(dek, header, index, true, data);
        break;
      }
      if (pending !== null) {
        yield openChunk(dek, header, index, false, pending);
        index += 1;
      }
      const next = await reader.readByte();
      if (next === null) {
        yield openChunk(dek, header, index, true, data);
        break;
      }
      reader.unshift(next);
      pending = data;
    }
  } finally {
    wipeKey(dek);
  }
}
