import { encryptStream, openEncryptedStream, type StorageEncryptionKeys } from "./encryption.ts";
import type { BlobSource, StorageDriver } from "./types.ts";

/**
 * Wrap a driver so blobs are encrypted at rest (D-117). The routing-facing behavior is
 * unchanged: the wrapper still returns the driver name and a content hash, because the hash
 * addresses the stored object (ciphertext). Stored bytes are unique per upload, which
 * deliberately turns off cross-upload deduplication: equal plaintexts no longer share a
 * blob (and no longer reveal that they are equal).
 *
 * The wrapper is a plain StorageDriver on purpose: it has no signedGetUrl, so an encrypted
 * deployment never hands a browser a direct bucket URL (that would serve ciphertext). The
 * app proxy reads and decrypts instead, which is the only safe path.
 */
export interface EncryptedStorageOptions {
  readonly driver: StorageDriver;
  readonly keys: StorageEncryptionKeys;
}

export function createEncryptedStorage(options: EncryptedStorageOptions): StorageDriver {
  const { driver, keys } = options;
  return {
    driver: driver.driver,
    async put(source: BlobSource) {
      let size = 0;
      const counted = (async function* count(): AsyncGenerator<Uint8Array> {
        for await (const part of source) {
          size += part.length;
          yield part;
        }
      })();
      const stored = await driver.put(encryptStream(counted, keys));
      // The metadata size is the user-visible plaintext size, not the ciphertext length.
      return { hash: stored.hash, size };
    },
    async get(hash: string) {
      // Header validation happens here, before the route builds a Response: a plaintext
      // legacy blob or a corrupt/unknown-key header is a 500, not a 200 aborting later.
      return openEncryptedStream(await driver.get(hash), keys);
    },
    exists: (hash: string) => driver.exists(hash),
    delete: (hash: string) => driver.delete(hash),
  };
}
