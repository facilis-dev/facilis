import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { createS3Storage, type FetchLike } from "./s3.ts";
import type { BlobSource } from "./types.ts";

const HASH = createHash("sha256").update("hello").digest("hex");

function stagingFiles(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith("facilis-s3-"));
}
const NOW = new Date("2026-11-01T10:20:30.000Z");

interface Call {
  url: string;
  init: { method?: string; headers?: Record<string, string>; duplex?: string };
  body?: Uint8Array;
}

async function bodyBytes(body: unknown): Promise<Uint8Array> {
  if (body === undefined) return new Uint8Array(0);
  if (body instanceof Uint8Array) return body;
  return new Uint8Array(await new Response(body as ReadableStream).arrayBuffer());
}

function fakeFetch(calls: Call[], response?: () => Response): FetchLike {
  return async (input, init) => {
    const call: Call = {
      url: input,
      init: { method: init.method, headers: init.headers, duplex: init.duplex },
    };
    if (init.body !== undefined) call.body = await bodyBytes(init.body);
    calls.push(call);
    return response?.() ?? new Response(null, { status: 200 });
  };
}

async function collect(source: BlobSource): Promise<Uint8Array> {
  const parts: Buffer[] = [];
  for await (const part of source) parts.push(Buffer.from(part));
  return new Uint8Array(Buffer.concat(parts));
}

function sourceOf(bytes: Uint8Array, chunkSize = 2): BlobSource {
  return (async function* () {
    for (let index = 0; index < bytes.length; index += chunkSize) {
      yield bytes.subarray(index, index + chunkSize);
    }
  })();
}

const base = {
  bucket: "facilis",
  region: "auto",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secret-key",
  endpoint: "https://minio.local:9000",
  now: () => NOW,
};

describe("s3-compatible storage", () => {
  it("streams a PUT with SigV4 headers and the payload hash", async () => {
    const calls: Call[] = [];
    const storage = createS3Storage({ ...base, fetch: fakeFetch(calls) });
    const result = await storage.put(sourceOf(new TextEncoder().encode("hello")));
    expect(result.hash).toBe(HASH);
    const [call] = calls;
    if (call === undefined) throw new Error("no request captured");
    expect(call.init.method).toBe("PUT");
    expect(call.url).toBe("https://minio.local:9000/facilis/blobs/" + HASH);
    expect(call.init.duplex).toBe("half");
    expect(call.init.headers?.["content-length"]).toBe("5");
    expect(call.body).toEqual(new TextEncoder().encode("hello"));
    expect(call.init.headers?.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20261101\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(call.init.headers?.["x-amz-content-sha256"]).toBe(HASH);
    expect(call.init.headers?.["x-amz-date"]).toBe("20261101T102030Z");
  });

  it("leaves no staging file when the source fails", async () => {
    const before = new Set(stagingFiles());
    const storage = createS3Storage({ ...base, fetch: fakeFetch([]) });
    const failing: BlobSource = (async function* () {
      yield new Uint8Array(100);
      throw new Error("boom");
    })();
    await expect(storage.put(failing)).rejects.toThrow(/staging failed/);
    expect(stagingFiles().filter((name) => !before.has(name))).toEqual([]);

    const emptyFailing: BlobSource = (async function* () {
      yield new Uint8Array(0);
      throw new Error("boom");
    })();
    await expect(storage.put(emptyFailing)).rejects.toThrow(/staging failed/);
    expect(stagingFiles().filter((name) => !before.has(name))).toEqual([]);
  });
  it("streams a GET body and maps HEAD 404 to false", async () => {
    const calls: Call[] = [];
    const getStorage = createS3Storage({
      ...base,
      fetch: fakeFetch(calls, () => new Response(new TextEncoder().encode("hello"))),
    });
    expect(new TextDecoder().decode(await collect(await getStorage.get(HASH)))).toBe("hello");

    const missing = createS3Storage({
      ...base,
      fetch: fakeFetch([], () => new Response(null, { status: 404 })),
    });
    expect(await missing.exists(HASH)).toBe(false);
  });

  it("presigns a deterministic GET URL (path-style for a custom endpoint)", async () => {
    const storage = createS3Storage({ ...base, fetch: fakeFetch([]) });
    const url = await storage.signedGetUrl(HASH, { expiresInSeconds: 300, responseName: "a.txt" });
    expect(url.startsWith("https://minio.local:9000/facilis/blobs/" + HASH + "?")).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(params.get("X-Amz-Expires")).toBe("300");
    expect(params.get("X-Amz-Date")).toBe("20261101T102030Z");
    expect(params.get("X-Amz-SignedHeaders")).toBe("host");
    expect(params.get("response-content-disposition")).toContain("a.txt");
    expect(params.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      storage.signedGetUrl(HASH, { expiresInSeconds: 300, responseName: "a.txt" }),
    ).resolves.toBe(url);
  });

  it("uses virtual-hosted URLs on AWS when no endpoint is configured", async () => {
    const storage = createS3Storage({
      bucket: "facilis",
      region: "us-east-1",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret-key",
      now: () => NOW,
      fetch: fakeFetch([]),
    });
    const url = await storage.signedGetUrl(HASH);
    expect(url.startsWith("https://facilis.s3.us-east-1.amazonaws.com/blobs/" + HASH + "?")).toBe(
      true,
    );
  });
});
