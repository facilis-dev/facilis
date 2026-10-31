import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { contentHash, createLocalStorage, isContentHash } from "./index.ts";

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

const bytes = (text: string) => new TextEncoder().encode(text);

describe("local content-addressed storage", () => {
  it("stores bytes once per content hash and reads them back", async () => {
    const root = tempRoot();
    const storage = createLocalStorage({ rootDir: root });
    const first = await storage.put(bytes("hello"));
    expect(isContentHash(first.hash)).toBe(true);
    expect(first.hash).toBe(contentHash(bytes("hello")));
    expect(first.size).toBe(5);
    expect(await storage.exists(first.hash)).toBe(true);
    expect(new TextDecoder().decode(await storage.get(first.hash))).toBe("hello");
  });

  it("deduplicates: the same bytes do not create a second body", async () => {
    const root = tempRoot();
    const storage = createLocalStorage({ rootDir: root });
    const a = await storage.put(bytes("same"));
    const b = await storage.put(bytes("same"));
    expect(b.hash).toBe(a.hash);
    const shards = readdirSync(join(root, a.hash.slice(0, 2)));
    expect(shards).toEqual([a.hash]);
  });

  it("self-ignores the blob directory for git", async () => {
    const root = tempRoot();
    const storage = createLocalStorage({ rootDir: root });
    await storage.put(bytes("x"));
    expect(existsSync(join(root, ".gitignore"))).toBe(true);
  });

  it("deletes idempotently and refuses a traversal-shaped hash", async () => {
    const root = tempRoot();
    const storage = createLocalStorage({ rootDir: root });
    const { hash } = await storage.put(bytes("gone"));
    await storage.delete(hash);
    await storage.delete(hash);
    expect(await storage.exists(hash)).toBe(false);
    await expect(storage.get("../etc/passwd")).rejects.toThrow(/invalid content hash/);
    await expect(storage.exists("../etc/passwd")).resolves.toBe(false);
  });
});
