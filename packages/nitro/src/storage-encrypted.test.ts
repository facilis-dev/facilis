import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_TENANT_ID, defineConfig, type AuthContext } from "@facilis/core";
import type { PolicyScopedDatabase } from "@facilis/db";
import { contentHash } from "@facilis/storage";

import { resolveStorage } from "./runtime/storage-target.ts";
import { sendStoredFile, storeUpload, type StoredFile } from "./storage.ts";

const AUTH: AuthContext = {
  userId: "00000000-0000-4000-8000-000000000001",
  roles: [],
  permissions: [],
};

const FILE_ID = "11111111-1111-4111-8111-111111111111";
const dirs: string[] = [];

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "facilis-encrypted-upload-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

interface Inserted {
  hash: string;
  name: string;
  mime: string;
  size: number;
}

function uploadDb(capture: { row?: Inserted }): PolicyScopedDatabase {
  return {
    insert: () => ({
      values: (values: Inserted) => {
        capture.row = values;
        return { returning: async () => [{ id: FILE_ID }] };
      },
    }),
  } as unknown as PolicyScopedDatabase;
}

function downloadDb(row: Inserted): PolicyScopedDatabase {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [row],
        }),
      }),
    }),
  } as unknown as PolicyScopedDatabase;
}

const ENCRYPTION_ENV = {
  FACILIS_STORAGE_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString("base64"),
};

describe("encrypted upload/download path", () => {
  it("streams a multipart file through encryption and back, storing only ciphertext", async () => {
    const project = tempProject();
    const resolved = resolveStorage(
      defineConfig({
        auth: { roles: { user: [] }, defaultRole: "user" },
        storage: { driver: "local", encryption: { enabled: true } },
      }),
      { NODE_ENV: "development", ...ENCRYPTION_ENV },
      project,
      { secret: "test-secret" },
    );
    expect(resolved.warnings).toEqual([]);
    const storage = resolved.storage;
    if (storage === null) throw new Error("expected encrypted storage");

    const plaintext = new TextEncoder().encode("secret attachment bytes ".repeat(50));
    const capture: { row?: Inserted } = {};
    const upload = await storeUpload({
      event: { context: {} } as never,
      db: uploadDb(capture),
      storage,
      auth: AUTH,
      file: new File([plaintext], "note.bin", { type: "application/octet-stream" }),
    });
    if (upload instanceof Response) throw new Error("upload rejected: " + upload.status);
    const stored: StoredFile = upload;
    const inserted = capture.row;
    if (inserted === undefined) throw new Error("metadata row was not captured");

    expect(stored.size).toBe(plaintext.length);
    expect(stored.name).toBe("note.bin");
    expect(inserted.hash).not.toBe(contentHash(plaintext));

    const binaryRoot = join(project, ".facilis", "binary");
    const shard = readdirSync(binaryRoot).find((entry) => /^[0-9a-f]{2}$/.test(entry));
    if (shard === undefined) throw new Error("no shard directory");
    const atRest = readFileSync(join(binaryRoot, shard, inserted.hash));
    expect(atRest.includes(Buffer.from("secret attachment"))).toBe(false);
    expect(atRest.byteLength).toBeGreaterThan(plaintext.length);

    const token = decodeURIComponent(stored.url.split("token=")[1] ?? "");
    const response = await sendStoredFile({
      db: downloadDb(inserted),
      storage,
      fileId: stored.id,
      token,
      tenantId: DEFAULT_TENANT_ID,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(String(plaintext.length));
    expect(response.headers.get("content-disposition")).toContain("note.bin");
    const downloaded = new Uint8Array(await response.arrayBuffer());
    expect(downloaded).toEqual(plaintext);
  });

  it("rejects a blob truncated to its header before returning a response", async () => {
    const project = tempProject();
    const resolved = resolveStorage(
      defineConfig({
        auth: { roles: { user: [] }, defaultRole: "user" },
        storage: { driver: "local", encryption: { enabled: true } },
      }),
      { NODE_ENV: "development", ...ENCRYPTION_ENV },
      project,
      { secret: "test-secret" },
    );
    const storage = resolved.storage;
    if (storage === null) throw new Error("expected encrypted storage");

    const plaintext = new TextEncoder().encode("truncated attachment ".repeat(100));
    const capture: { row?: Inserted } = {};
    const upload = await storeUpload({
      event: { context: {} } as never,
      db: uploadDb(capture),
      storage,
      auth: AUTH,
      file: new File([plaintext], "truncated.bin", { type: "application/octet-stream" }),
    });
    if (upload instanceof Response) throw new Error("upload rejected: " + upload.status);
    const stored: StoredFile = upload;
    const inserted = capture.row;
    if (inserted === undefined) throw new Error("metadata row was not captured");

    const binaryRoot = join(project, ".facilis", "binary");
    const shard = readdirSync(binaryRoot).find((entry) => /^[0-9a-f]{2}$/.test(entry));
    if (shard === undefined) throw new Error("no shard directory");
    const path = join(binaryRoot, shard, inserted.hash);
    const atRest = readFileSync(path);
    const headerLength = 10 + (atRest[9] ?? 0) + 4 + 12 + 48;
    writeFileSync(path, atRest.subarray(0, headerLength));

    const token = decodeURIComponent(stored.url.split("token=")[1] ?? "");
    await expect(
      sendStoredFile({
        db: downloadDb(inserted),
        storage,
        fileId: stored.id,
        token,
        tenantId: DEFAULT_TENANT_ID,
      }),
    ).rejects.toThrow();
  });
});
