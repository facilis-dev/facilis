import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createS3Storage, type FetchLike } from "./s3.ts";

const HASH = createHash("sha256").update("hello").digest("hex");
const NOW = new Date("2026-11-01T10:20:30.000Z");

interface Call {
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: unknown };
}

function fakeFetch(calls: Call[], response?: () => Response): FetchLike {
  return async (input, init) => {
    calls.push({
      url: input,
      init: {
        method: init.method,
        headers: init.headers,
        body: init.body,
      },
    });
    return response?.() ?? new Response(null, { status: 200 });
  };
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
  it("PUTs a content-addressed object with SigV4 headers", async () => {
    const calls: Call[] = [];
    const storage = createS3Storage({ ...base, fetch: fakeFetch(calls) });
    const result = await storage.put(new TextEncoder().encode("hello"));
    expect(result.hash).toBe(HASH);
    const [call] = calls;
    if (call === undefined) throw new Error("no request captured");
    expect(call.init.method).toBe("PUT");
    expect(call.url).toBe("https://minio.local:9000/facilis/blobs/" + HASH);
    expect(call.init.headers?.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20261101\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(call.init.headers?.["x-amz-content-sha256"]).toBe(HASH);
    expect(call.init.headers?.["x-amz-date"]).toBe("20261101T102030Z");
  });

  it("GETs and returns the body, HEAD maps 404 to false", async () => {
    const calls: Call[] = [];
    const getStorage = createS3Storage({
      ...base,
      fetch: fakeFetch(calls, () => new Response(new TextEncoder().encode("hello"))),
    });
    expect(new TextDecoder().decode(await getStorage.get(HASH))).toBe("hello");

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
