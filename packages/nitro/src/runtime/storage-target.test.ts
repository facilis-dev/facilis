import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { defineConfig } from "@facilis/core";
import { contentHash } from "@facilis/storage";

import { resolveStorage } from "./storage-target.ts";

const CONFIG = defineConfig({
  auth: { roles: { user: [] }, defaultRole: "user" },
  storage: { driver: "local", maxUploadBytes: 1024, tokenTtlSeconds: 60 },
});

function configWith(storage: Parameters<typeof defineConfig>[0]["storage"]) {
  return defineConfig({
    auth: { roles: { user: [] }, defaultRole: "user" },
    storage,
  });
}

const S3_ENV = {
  FACILIS_S3_ACCESS_KEY_ID: "key",
  FACILIS_S3_SECRET_ACCESS_KEY: "secret",
};

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const ENCRYPTION_ENV = { FACILIS_STORAGE_ENCRYPTION_KEY: ENCRYPTION_KEY };

const dirs: string[] = [];

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "facilis-storage-target-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Buffer[] = [];
  for await (const part of source) parts.push(Buffer.from(part));
  return new Uint8Array(Buffer.concat(parts));
}

function sourceOf(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield bytes;
  })();
}

describe("resolveStorage", () => {
  it("boots the local driver in development and signs round-tripping URLs", () => {
    const resolved = resolveStorage(CONFIG, {}, "/project", { secret: "dev-secret" });

    expect(resolved.warnings).toEqual([]);
    const storage = resolved.storage;
    expect(storage?.available).toBe(true);
    expect(storage?.kind).toBe("local");
    expect(storage?.maxUploadBytes).toBe(1024);

    const id = "00000000-0000-4000-8000-000000000001";
    const url = storage?.buildDownloadUrl(id, { tenantId: "tenant", subject: "user" }) ?? "";
    expect(url.startsWith("/api/files/" + encodeURIComponent(id) + "?token=")).toBe(true);
    const token = decodeURIComponent(url.split("token=")[1] ?? "");
    expect(storage?.verifyDownloadToken(token, id)).toMatchObject({
      fileId: id,
      tenantId: "tenant",
    });
    expect(storage?.verifyDownloadToken(token, "00000000-0000-4000-8000-000000000002")).toBeNull();
    expect(storage?.verifyDownloadToken(token + "x", id)).toBeNull();
  });

  it("refuses the local driver in production", () => {
    const resolved = resolveStorage(CONFIG, { NODE_ENV: "production" }, "/project", {
      secret: "prod-secret",
    });

    expect(resolved.storage).toBeNull();
    expect(resolved.warnings.map((entry) => entry.code)).toEqual(["storage_local_in_production"]);
  });

  it("boots an S3 driver with credentials from the environment", () => {
    const resolved = resolveStorage(
      configWith({ driver: "s3", bucket: "bucket", region: "auto" }),
      S3_ENV,
      "/project",
      { secret: "dev-secret" },
    );

    expect(resolved.warnings).toEqual([]);
    expect(resolved.storage?.kind).toBe("s3");
    expect(typeof resolved.storage?.presignedGetUrl).toBe("function");
  });

  it("reports missing S3 credentials as a dedicated warning", () => {
    const resolved = resolveStorage(
      configWith({ driver: "s3", bucket: "bucket", region: "auto" }),
      {},
      "/project",
      { secret: "dev-secret" },
    );

    expect(resolved.storage).toBeNull();
    expect(resolved.warnings.map((entry) => entry.code)).toEqual([
      "storage_s3_credentials_missing",
    ]);
  });

  it("requires a stable secret in production even with S3 configured", () => {
    const resolved = resolveStorage(
      configWith({ driver: "s3", bucket: "bucket", region: "auto" }),
      { NODE_ENV: "production", ...S3_ENV },
      "/project",
    );

    expect(resolved.storage).toBeNull();
    expect(resolved.warnings.map((entry) => entry.code)).toEqual(["storage_secret_missing"]);
  });

  it("boots production S3 when the secret is set", () => {
    const resolved = resolveStorage(
      configWith({ driver: "s3", bucket: "bucket", region: "auto" }),
      { NODE_ENV: "production", FACILIS_STORAGE_SECRET: "stable", ...S3_ENV },
      "/project",
    );

    expect(resolved.warnings).toEqual([]);
    expect(resolved.storage?.available).toBe(true);
  });

  it("degrades to a warning when the driver cannot be constructed", () => {
    const resolved = resolveStorage(CONFIG, {}, "/project", {
      secret: "dev-secret",
      createDriver: () => {
        throw new Error("boom");
      },
    });

    expect(resolved.storage).toBeNull();
    expect(resolved.warnings.map((entry) => entry.code)).toEqual(["storage_boot_failed"]);
  });
});

describe("resolveStorage encryption", () => {
  it("reports a missing encryption key as a dedicated warning", () => {
    const resolved = resolveStorage(
      configWith({ driver: "local", encryption: { enabled: true } }),
      {},
      "/project",
      { secret: "dev-secret" },
    );

    expect(resolved.storage).toBeNull();
    expect(resolved.warnings.map((entry) => entry.code)).toEqual([
      "storage_encryption_key_missing",
    ]);
  });

  it("reports a malformed encryption key as a dedicated warning", () => {
    const resolved = resolveStorage(
      configWith({ driver: "local", encryption: { enabled: true } }),
      { FACILIS_STORAGE_ENCRYPTION_KEY: "not-a-key" },
      "/project",
      { secret: "dev-secret" },
    );

    expect(resolved.storage).toBeNull();
    expect(resolved.warnings.map((entry) => entry.code)).toEqual([
      "storage_encryption_key_invalid",
    ]);
  });

  it("round-trips encrypted bytes through the local driver and exposes no presign", async () => {
    const project = tempProject();
    const resolved = resolveStorage(
      configWith({ driver: "local", encryption: { enabled: true } }),
      ENCRYPTION_ENV,
      project,
      { secret: "dev-secret" },
    );

    expect(resolved.warnings).toEqual([]);
    const storage = resolved.storage;
    if (storage === null) throw new Error("expected storage");

    const plaintext = new TextEncoder().encode("hello encrypted world");
    const put = await storage.put(sourceOf(plaintext));
    expect(put.size).toBe(plaintext.length);
    expect(put.hash).not.toBe(contentHash(plaintext));
    expect(await collect(await storage.get(put.hash))).toEqual(plaintext);
    expect(storage.presignedGetUrl).toBeUndefined();
  });

  it("does not expose S3 presigned URLs when encryption is enabled", () => {
    const resolved = resolveStorage(
      configWith({ driver: "s3", bucket: "bucket", region: "auto", encryption: { enabled: true } }),
      { ...S3_ENV, ...ENCRYPTION_ENV },
      "/project",
      { secret: "dev-secret" },
    );

    expect(resolved.warnings).toEqual([]);
    expect(resolved.storage?.kind).toBe("s3");
    expect(resolved.storage?.presignedGetUrl).toBeUndefined();
  });
});
