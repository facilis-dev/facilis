import { createHash, createHmac } from "node:crypto";

import { contentHash, isContentHash } from "./hash.ts";
import {
  StorageError,
  type PutResult,
  type SignedGetUrlOptions,
  type SigningStorageDriver,
} from "./types.ts";

/**
 * S3-compatible storage: AWS S3, Cloudflare R2 and MinIO all speak Signature V4, so one
 * driver covers them (D-053). Set endpoint (+ path style for R2/MinIO); leave them out for
 * AWS virtual-hosted buckets.
 *
 * Signing and presigning are implemented on node:crypto + fetch (no AWS SDK): the surface
 * we need is tiny and the framework runtime must stay light.
 */
export interface S3StorageOptions {
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  /** Custom endpoint: R2 (https://<account>.r2.cloudflarestorage.com) or MinIO. */
  readonly endpoint?: string;
  /** Path-style URLs. Defaults to true with a custom endpoint, false on AWS. */
  readonly forcePathStyle?: boolean;
  /** Injectable for tests. */
  readonly fetch?: FetchLike;
  /** Injectable clock for deterministic presign tests. */
  readonly now?: () => Date;
}

/**
 * The two calls this driver needs. Narrower than the platform `fetch` so the package does
 * not need DOM lib types; `globalThis.fetch` is adapted once below.
 */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: Uint8Array },
) => Promise<Response>;

const SERVICE = "s3";
const EMPTY_SHA256 = sha256Hex("");
const DEFAULT_TTL_SECONDS = 300;

export function createS3Storage(options: S3StorageOptions): SigningStorageDriver {
  const fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const now = options.now ?? (() => new Date());
  const pathStyle = options.forcePathStyle ?? options.endpoint !== undefined;
  const origin = baseOrigin(options, pathStyle);
  const host = new URL(origin).host;

  const keyOf = (hash: string) => "blobs/" + hash;
  const pathOf = (key: string) =>
    pathStyle ? "/" + options.bucket + "/" + encodePath(key) : "/" + encodePath(key);

  function urlFor(key: string, query: Record<string, string> = {}): string {
    const search = encodeQuery(query);
    return origin + pathOf(key) + (search === "" ? "" : "?" + search);
  }

  function signHeaders(
    method: "PUT" | "GET" | "HEAD" | "DELETE",
    key: string,
    payloadHash: string,
  ): Record<string, string> {
    const amzDate = amzDateString(now());
    const dateStamp = amzDate.slice(0, 8);
    const scope = dateStamp + "/" + options.region + "/" + SERVICE + "/aws4_request";
    const canonicalHeaders =
      "host:" +
      host +
      "\n" +
      "x-amz-content-sha256:" +
      payloadHash +
      "\n" +
      "x-amz-date:" +
      amzDate +
      "\n" +
      (options.sessionToken === undefined
        ? ""
        : "x-amz-security-token:" + options.sessionToken + "\n");
    const signedNames =
      options.sessionToken === undefined
        ? "host;x-amz-content-sha256;x-amz-date"
        : "host;x-amz-content-sha256;x-amz-date;x-amz-security-token";
    const canonicalRequest =
      method +
      "\n" +
      pathOf(key) +
      "\n" +
      "" +
      "\n" +
      canonicalHeaders +
      "\n" +
      signedNames +
      "\n" +
      payloadHash;
    const signature = sign(canonicalRequest, amzDate, scope, options, dateStamp);
    const headers: Record<string, string> = {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      authorization:
        "AWS4-HMAC-SHA256 Credential=" +
        options.accessKeyId +
        "/" +
        scope +
        ", SignedHeaders=" +
        signedNames +
        ", Signature=" +
        signature,
    };
    if (options.sessionToken !== undefined) headers["x-amz-security-token"] = options.sessionToken;
    return headers;
  }

  return {
    driver: "s3",

    async put(bytes: Uint8Array): Promise<PutResult> {
      const hash = contentHash(bytes);
      const key = keyOf(hash);
      const response = await fetchImpl(urlFor(key), {
        method: "PUT",
        headers: {
          ...signHeaders("PUT", key, sha256Hex(bytes)),
          "content-type": "application/octet-stream",
        },
        body: bytes,
      });
      if (!response.ok) {
        throw new StorageError("s3: PUT " + key + " failed with HTTP " + response.status);
      }
      return { hash, size: bytes.length };
    },

    async get(hash: string): Promise<Uint8Array> {
      if (!isContentHash(hash)) throw new StorageError("invalid content hash");
      const key = keyOf(hash);
      const response = await fetchImpl(urlFor(key), {
        method: "GET",
        headers: signHeaders("GET", key, EMPTY_SHA256),
      });
      if (!response.ok) {
        throw new StorageError("s3: GET " + key + " failed with HTTP " + response.status);
      }
      return new Uint8Array(await response.arrayBuffer());
    },

    async exists(hash: string): Promise<boolean> {
      if (!isContentHash(hash)) return false;
      const key = keyOf(hash);
      const response = await fetchImpl(urlFor(key), {
        method: "HEAD",
        headers: signHeaders("HEAD", key, EMPTY_SHA256),
      });
      if (response.status === 404) return false;
      if (!response.ok) {
        throw new StorageError("s3: HEAD " + key + " failed with HTTP " + response.status);
      }
      return true;
    },

    async delete(hash: string): Promise<void> {
      if (!isContentHash(hash)) throw new StorageError("invalid content hash");
      const key = keyOf(hash);
      const response = await fetchImpl(urlFor(key), {
        method: "DELETE",
        headers: signHeaders("DELETE", key, EMPTY_SHA256),
      });
      if (!response.ok && response.status !== 404) {
        throw new StorageError("s3: DELETE " + key + " failed with HTTP " + response.status);
      }
    },

    async signedGetUrl(hash: string, urlOptions: SignedGetUrlOptions = {}): Promise<string> {
      if (!isContentHash(hash)) throw new StorageError("invalid content hash");
      const ttl = Math.min(
        Math.max(Math.trunc(urlOptions.expiresInSeconds ?? DEFAULT_TTL_SECONDS), 1),
        604_800,
      );
      const amzDate = amzDateString(now());
      const dateStamp = amzDate.slice(0, 8);
      const scope = dateStamp + "/" + options.region + "/" + SERVICE + "/aws4_request";
      const query: Record<string, string> = {
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": options.accessKeyId + "/" + scope,
        "X-Amz-Date": amzDate,
        "X-Amz-Expires": String(ttl),
        "X-Amz-SignedHeaders": "host",
      };
      if (options.sessionToken !== undefined) query["X-Amz-Security-Token"] = options.sessionToken;
      if (urlOptions.responseName !== undefined) {
        query["response-content-disposition"] = attachmentDisposition(urlOptions.responseName);
      }
      const canonicalRequest =
        "GET\n" +
        pathOf(keyOf(hash)) +
        "\n" +
        encodeQuery(query) +
        "\n" +
        "host:" +
        host +
        "\n\n" +
        "host\n" +
        "UNSIGNED-PAYLOAD";
      const signature = sign(canonicalRequest, amzDate, scope, options, dateStamp);
      return urlFor(keyOf(hash), { ...query, "X-Amz-Signature": signature });
    },
  };
}

function sign(
  canonicalRequest: string,
  amzDate: string,
  scope: string,
  options: S3StorageOptions,
  dateStamp: string,
): string {
  const stringToSign =
    "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + sha256Hex(canonicalRequest);
  const kDate = hmac("AWS4" + options.secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, options.region);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, "aws4_request");
  return createHmac("sha256", kSigning).update(stringToSign).digest("hex");
}

function baseOrigin(options: S3StorageOptions, pathStyle: boolean): string {
  if (options.endpoint !== undefined) {
    const endpoint = options.endpoint.replace(/\/+$/, "");
    return pathStyle ? endpoint : endpoint.replace("://", "://" + options.bucket + ".");
  }
  return pathStyle
    ? "https://s3." + options.region + ".amazonaws.com"
    : "https://" + options.bucket + ".s3." + options.region + ".amazonaws.com";
}

function amzDateString(date: Date): string {
  // 2026-11-01T10:20:30.000Z -> 20261101T102030Z (AWS ISO8601 basic format).
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function attachmentDisposition(name: string): string {
  const safe = name.replace(/["\\\r\n]/g, "_");
  return 'attachment; filename="' + safe + '"';
}

function sha256Hex(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function encodePath(path: string): string {
  return path.split("/").map(encode).join("/");
}

function encodeQuery(query: Record<string, string>): string {
  return Object.entries(query)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => encode(key) + "=" + encode(value))
    .join("&");
}
