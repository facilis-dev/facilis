import { describe, expect, it } from "vitest";

import { createEncryptedStorage } from "./encrypted.ts";
import { contentHash } from "./hash.ts";
import { StorageError, type BlobSource, type StorageDriver } from "./types.ts";

const KEY = new Uint8Array(32).fill(3);

async function collect(source: BlobSource): Promise<Uint8Array> {
  const parts: Buffer[] = [];
  for await (const part of source) parts.push(Buffer.from(part));
  return new Uint8Array(Buffer.concat(parts));
}

function sourceOf(bytes: Uint8Array, chunkSize = 5): BlobSource {
  return (async function* () {
    for (let index = 0; index < bytes.length; index += chunkSize) {
      yield bytes.subarray(index, index + chunkSize);
    }
  })();
}

function memoryDriver(): StorageDriver & { blobs: Map<string, Uint8Array> } {
  const blobs = new Map<string, Uint8Array>();
  return {
    driver: "local",
    blobs,
    async put(source) {
      const bytes = await collect(source);
      const hash = contentHash(bytes);
      blobs.set(hash, bytes);
      return { hash, size: bytes.length };
    },
    async get(hash) {
      const found = blobs.get(hash);
      if (found === undefined) throw new Error("missing " + hash);
      return sourceOf(found);
    },
    async exists(hash) {
      return blobs.has(hash);
    },
    async delete(hash) {
      blobs.delete(hash);
    },
  };
}

describe("createEncryptedStorage", () => {
  it("stacks ciphertext, returns the plaintext size and keeps the driver kind", async () => {
    const inner = memoryDriver();
    const storage = createEncryptedStorage({
      driver: inner,
      keys: { activeKeyId: "primary", keys: { primary: KEY } },
    });
    const plaintext = new TextEncoder().encode("hello attachment");
    const put = await storage.put(sourceOf(plaintext));
    expect(storage.driver).toBe("local");
    expect(put.size).toBe(plaintext.length);
    expect(inner.blobs.has(put.hash)).toBe(true);
    const stored = inner.blobs.get(put.hash) ?? new Uint8Array();
    expect(stored.byteLength).toBeGreaterThan(plaintext.length);
    expect(Buffer.from(stored).includes(Buffer.from(plaintext))).toBe(false);
    expect(put.hash).not.toBe(contentHash(plaintext));
    expect(await collect(await storage.get(put.hash))).toEqual(plaintext);
    await expect(storage.exists(put.hash)).resolves.toBe(true);
    await storage.delete(put.hash);
    await expect(storage.exists(put.hash)).resolves.toBe(false);
  });

  it("disables deduplication: equal plaintexts become distinct encrypted blobs", async () => {
    const inner = memoryDriver();
    const storage = createEncryptedStorage({
      driver: inner,
      keys: { activeKeyId: "primary", keys: { primary: KEY } },
    });
    const plaintext = new TextEncoder().encode("same bytes");
    const first = await storage.put(sourceOf(plaintext));
    const second = await storage.put(sourceOf(plaintext));
    expect(first.hash).not.toBe(second.hash);
    expect(inner.blobs.size).toBe(2);
  });

  it("rejects a plaintext legacy blob before the caller builds a response", async () => {
    const inner = memoryDriver();
    const plaintext = new TextEncoder().encode("legacy plaintext");
    const legacy = await inner.put(sourceOf(plaintext));
    const storage = createEncryptedStorage({
      driver: inner,
      keys: { activeKeyId: "primary", keys: { primary: KEY } },
    });
    await expect(storage.get(legacy.hash)).rejects.toThrow(StorageError);
  });

  it("does not expose a presigned direct-download method", () => {
    const storage = createEncryptedStorage({
      driver: memoryDriver(),
      keys: { activeKeyId: "primary", keys: { primary: KEY } },
    });
    expect("signedGetUrl" in storage).toBe(false);
  });
});
