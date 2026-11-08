import { describe, expect, it } from "vitest";

import {
  decryptStream,
  encryptStream,
  isEncryptedBlob,
  isValidEncryptionKeyId,
  STORAGE_ENCRYPTION_CHUNK_BYTES,
  type StorageEncryptionKeys,
} from "./encryption.ts";
import { StorageError, type BlobSource } from "./types.ts";

const KEY = new Uint8Array(32).fill(7);
const OTHER_KEY = new Uint8Array(32).fill(9);

function keyring(
  activeKeyId = "primary",
  keys: Record<string, Uint8Array> = { primary: KEY },
): StorageEncryptionKeys {
  return { activeKeyId, keys };
}

async function collect(source: BlobSource): Promise<Uint8Array> {
  const parts: Buffer[] = [];
  for await (const part of source) parts.push(Buffer.from(part));
  return new Uint8Array(Buffer.concat(parts));
}

function sourceOf(bytes: Uint8Array, chunkSize = 4096): BlobSource {
  return (async function* () {
    for (let index = 0; index < bytes.length; index += chunkSize) {
      yield bytes.subarray(index, index + chunkSize);
    }
  })();
}

function plaintextOf(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) out[index] = (index * 31 + seed) % 251;
  return out;
}

function keyIdOf(blob: Uint8Array): string {
  const length = blob[9] ?? 0;
  return Buffer.from(blob.subarray(10, 10 + length)).toString("ascii");
}

describe("encryptStream / decryptStream", () => {
  it("round-trips the empty blob", async () => {
    const blob = await collect(encryptStream(sourceOf(new Uint8Array(0)), keyring()));
    expect(isEncryptedBlob(blob)).toBe(true);
    expect(await collect(decryptStream(sourceOf(blob), keyring()))).toEqual(new Uint8Array(0));
  });

  it.each([
    ["one byte", 1],
    ["just under a chunk", STORAGE_ENCRYPTION_CHUNK_BYTES - 1],
    ["exactly one chunk", STORAGE_ENCRYPTION_CHUNK_BYTES],
    ["one chunk plus one", STORAGE_ENCRYPTION_CHUNK_BYTES + 1],
    ["two chunks and a tail", STORAGE_ENCRYPTION_CHUNK_BYTES * 2 + 17],
  ])("round-trips %s", async (_label, length) => {
    const plaintext = plaintextOf(length);
    const blob = await collect(encryptStream(sourceOf(plaintext), keyring()));
    expect(await collect(decryptStream(sourceOf(blob), keyring()))).toEqual(plaintext);
  });

  it("is independent of how the source and the stored blob are chunked", async () => {
    const plaintext = plaintextOf(2500);
    const blob = await collect(encryptStream(sourceOf(plaintext, 1), keyring()));
    expect(await collect(decryptStream(sourceOf(blob, 3), keyring()))).toEqual(plaintext);
  });

  it("writes a self-describing header with the active key id", async () => {
    const blob = await collect(
      encryptStream(sourceOf(plaintextOf(10)), keyring("k-2026", { "k-2026": KEY })),
    );
    expect(Buffer.from(blob.subarray(0, 8)).toString("ascii")).toBe("FACILIS1");
    expect(blob[8]).toBe(1);
    expect(keyIdOf(blob)).toBe("k-2026");
    expect(Buffer.from(blob).readUInt32BE(10 + "k-2026".length)).toBe(
      STORAGE_ENCRYPTION_CHUNK_BYTES,
    );
  });

  it("never stores the plaintext and never repeats ciphertext", async () => {
    const plaintext = new TextEncoder().encode("the same secret");
    const first = await collect(encryptStream(sourceOf(plaintext), keyring()));
    const second = await collect(encryptStream(sourceOf(plaintext), keyring()));
    expect(Buffer.from(first).includes(Buffer.from("the same secret"))).toBe(false);
    expect(first).not.toEqual(second);
  });

  it("rejects an unknown key id instead of falling back", async () => {
    const blob = await collect(
      encryptStream(sourceOf(plaintextOf(10)), keyring("old", { old: KEY })),
    );
    await expect(
      collect(decryptStream(sourceOf(blob), keyring("primary", { primary: KEY }))),
    ).rejects.toThrow(StorageError);
  });

  it("rejects the wrong key material", async () => {
    const blob = await collect(encryptStream(sourceOf(plaintextOf(10)), keyring()));
    await expect(
      collect(decryptStream(sourceOf(blob), keyring("primary", { primary: OTHER_KEY }))),
    ).rejects.toThrow(StorageError);
  });

  it("rejects a plaintext legacy blob", async () => {
    await expect(
      collect(decryptStream(sourceOf(new TextEncoder().encode("hello")), keyring())),
    ).rejects.toThrow(StorageError);
  });

  it("detects a flipped ciphertext byte and an edited header", async () => {
    const blob = await collect(encryptStream(sourceOf(plaintextOf(2000)), keyring()));
    const flipped = new Uint8Array(blob);
    flipped[flipped.length - 1] = (flipped[flipped.length - 1] ?? 0) ^ 0xff;
    await expect(collect(decryptStream(sourceOf(flipped), keyring()))).rejects.toThrow(
      StorageError,
    );

    const editedKey = new Uint8Array(blob);
    editedKey[10] = 0x78;
    await expect(collect(decryptStream(sourceOf(editedKey), keyring()))).rejects.toThrow(
      StorageError,
    );
  });

  it("detects a truncated blob", async () => {
    const blob = await collect(encryptStream(sourceOf(plaintextOf(2000)), keyring()));
    await expect(
      collect(decryptStream(sourceOf(blob.subarray(0, blob.length - 10)), keyring())),
    ).rejects.toThrow(StorageError);
  });

  it("rejects an invalid active key id and a short key", async () => {
    await expect(
      collect(encryptStream(sourceOf(plaintextOf(1)), keyring("bad id!"))),
    ).rejects.toThrow(StorageError);
    await expect(
      collect(
        encryptStream(
          sourceOf(plaintextOf(1)),
          keyring("primary", { primary: KEY.subarray(0, 16) }),
        ),
      ),
    ).rejects.toThrow(StorageError);
  });

  it("supports rotation: retired keys decrypt, the active key encrypts", async () => {
    const oldBlob = await collect(
      encryptStream(sourceOf(plaintextOf(64)), keyring("old", { old: KEY })),
    );
    const rotated: StorageEncryptionKeys = {
      activeKeyId: "new",
      keys: { new: OTHER_KEY, old: KEY },
    };
    expect(await collect(decryptStream(sourceOf(oldBlob), rotated))).toEqual(plaintextOf(64));
    const newBlob = await collect(encryptStream(sourceOf(plaintextOf(64)), rotated));
    expect(keyIdOf(newBlob)).toBe("new");
    await expect(
      collect(decryptStream(sourceOf(oldBlob), keyring("new", { new: OTHER_KEY }))),
    ).rejects.toThrow(StorageError);
  });

  it("rejects a header-only blob instead of decrypting it as empty", async () => {
    const blob = await collect(encryptStream(sourceOf(plaintextOf(1000)), keyring()));
    const headerLength = 10 + (blob[9] ?? 0) + 4 + 12 + 48;
    expect(blob.length).toBeGreaterThan(headerLength);
    await expect(
      collect(decryptStream(sourceOf(blob.subarray(0, headerLength)), keyring())),
    ).rejects.toThrow(StorageError);
  });

  it("always emits one final frame, even for an empty plaintext", async () => {
    const blob = await collect(encryptStream(sourceOf(new Uint8Array(0)), keyring()));
    const headerLength = 10 + (blob[9] ?? 0) + 4 + 12 + 48;
    expect(blob.length).toBe(headerLength + 12 + 16);
    expect(await collect(decryptStream(sourceOf(blob), keyring()))).toEqual(new Uint8Array(0));
  });

  it("rejects appended bytes", async () => {
    const blob = await collect(encryptStream(sourceOf(plaintextOf(100)), keyring()));
    const appended = new Uint8Array(blob.length + 1);
    appended.set(blob);
    await expect(collect(decryptStream(sourceOf(appended), keyring()))).rejects.toThrow(
      StorageError,
    );
  });

  it("rejects a dropped first chunk", async () => {
    const payload = plaintextOf(STORAGE_ENCRYPTION_CHUNK_BYTES + 1000);
    const blob = await collect(encryptStream(sourceOf(payload), keyring()));
    const headerLength = 10 + (blob[9] ?? 0) + 4 + 12 + 48;
    const frame = STORAGE_ENCRYPTION_CHUNK_BYTES + 12 + 16;
    const dropped = new Uint8Array(blob.length - frame);
    dropped.set(blob.subarray(0, headerLength), 0);
    dropped.set(blob.subarray(headerLength + frame), headerLength);
    await expect(collect(decryptStream(sourceOf(dropped), keyring()))).rejects.toThrow(
      StorageError,
    );
  });

  it("rejects an edited version or chunk-size header field", async () => {
    const blob = await collect(encryptStream(sourceOf(plaintextOf(100)), keyring()));
    const editedVersion = new Uint8Array(blob);
    editedVersion[8] = 9;
    await expect(collect(decryptStream(sourceOf(editedVersion), keyring()))).rejects.toThrow(
      StorageError,
    );
    const editedChunkSize = new Uint8Array(blob);
    const chunkSizeOffset = 10 + (blob[9] ?? 0);
    editedChunkSize[chunkSizeOffset + 1] = 0x11;
    await expect(collect(decryptStream(sourceOf(editedChunkSize), keyring()))).rejects.toThrow(
      StorageError,
    );
  });

  it("validates key ids", () => {
    expect(isValidEncryptionKeyId("primary")).toBe(true);
    expect(isValidEncryptionKeyId("release-2026.01")).toBe(true);
    expect(isValidEncryptionKeyId("")).toBe(false);
    expect(isValidEncryptionKeyId("has space")).toBe(false);
    expect(isValidEncryptionKeyId("a".repeat(65))).toBe(false);
  });
});
