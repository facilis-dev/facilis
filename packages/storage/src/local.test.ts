import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { contentHash, createLocalStorage, isContentHash } from "./index.ts";
import type { BlobSource } from "./types.ts";

const dirs: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "facilis-storage-"));
  dirs.push(dir);
  return join(dir, ".facilis", "binary");
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

async function collect(source: BlobSource): Promise<Uint8Array> {
  const parts: Buffer[] = [];
  for await (const part of source) parts.push(Buffer.from(part));
  return new Uint8Array(Buffer.concat(parts));
}

function sourceOf(bytes: Uint8Array, chunkSize = 7): BlobSource {
  return (async function* () {
    for (let index = 0; index < bytes.length; index += chunkSize) {
      yield bytes.subarray(index, index + chunkSize);
    }
  })();
}

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);

describe("local content-addressed storage", () => {
  it("streams bytes in, hashes them and streams them back out", async () => {
    const root = tempRoot();
    const storage = createLocalStorage({ rootDir: root });
    const first = await storage.put(sourceOf(bytes("hello")));
    expect(isContentHash(first.hash)).toBe(true);
    expect(first.hash).toBe(contentHash(bytes("hello")));
    expect(first.size).toBe(5);
    expect(await storage.exists(first.hash)).toBe(true);
    expect(text(await collect(await storage.get(first.hash)))).toBe("hello");
  });

  it("deduplicates: the same bytes do not create a second body", async () => {
    const root = tempRoot();
    const storage = createLocalStorage({ rootDir: root });
    const a = await storage.put(sourceOf(bytes("same")));
    const b = await storage.put(sourceOf(bytes("same")));
    expect(b.hash).toBe(a.hash);
    const shards = readdirSync(join(root, a.hash.slice(0, 2)));
    expect(shards).toEqual([a.hash]);
  });

  it("self-ignores the blob directory for git", async () => {
    const root = tempRoot();
    const storage = createLocalStorage({ rootDir: root });
    await storage.put(sourceOf(bytes("x")));
    expect(existsSync(join(root, ".gitignore"))).toBe(true);
  });

  it("leaves no temp file when the source fails", async () => {
    const root = tempRoot();
    const storage = createLocalStorage({ rootDir: root });
    const failing: BlobSource = (async function* () {
      yield new Uint8Array(100);
      throw new Error("boom");
    })();
    await expect(storage.put(failing)).rejects.toThrow(/write failed/);
    expect(readdirSync(root).filter((name) => name.endsWith(".tmp"))).toEqual([]);

    const emptyFailing: BlobSource = (async function* () {
      yield new Uint8Array(0);
      throw new Error("boom");
    })();
    await expect(storage.put(emptyFailing)).rejects.toThrow(/write failed/);
    expect(readdirSync(root).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
  it("deletes idempotently and refuses a traversal-shaped hash", async () => {
    const root = tempRoot();
    const storage = createLocalStorage({ rootDir: root });
    const { hash } = await storage.put(sourceOf(bytes("gone")));
    await storage.delete(hash);
    await storage.delete(hash);
    expect(await storage.exists(hash)).toBe(false);
    await expect(storage.get("../etc/passwd")).rejects.toThrow(/invalid content hash/);
    await expect(storage.exists("../etc/passwd")).resolves.toBe(false);
  });

  it("reads back bytes that arrived in many tiny chunks", async () => {
    const root = tempRoot();
    const storage = createLocalStorage({ rootDir: root });
    const payload = bytes("a".repeat(10_000));
    const { hash } = await storage.put(sourceOf(payload, 3));
    expect(await collect(await storage.get(hash))).toEqual(payload);
  });
});
