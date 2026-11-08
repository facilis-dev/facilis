import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";

import { isContentHash } from "./hash.ts";
import { createS3Signer, EMPTY_PAYLOAD_SHA256, type S3SigningOptions } from "./s3-signing.ts";
import {
  StorageError,
  type BlobSource,
  type PutResult,
  type SignedGetUrlOptions,
  type SigningStorageDriver,
} from "./types.ts";

/**
 * S3-compatible storage: AWS S3, Cloudflare R2 and MinIO all speak Signature V4, so one
 * driver covers them (D-053). Set endpoint (+ path style for R2/MinIO); leave them out for
 * AWS virtual-hosted buckets.
 *
 * Bytes stream in both directions (D-117). PUT must know the payload hash and length for
 * SigV4, so the source is staged to a temp file while it is hashed (disk, not memory, and
 * bounded by the upload limit); GET returns the response body as a stream.
 */
export interface S3StorageOptions extends S3SigningOptions {
  /** Injectable for tests. */
  readonly fetch?: FetchLike;
}

/**
 * The calls this driver needs. Narrower than the platform fetch so the package does not
 * need DOM lib types; globalThis.fetch is adapted once below. A streamed body needs
 * "duplex": "half" in Node's fetch and carries the content-length header.
 */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: Uint8Array | ReadableStream<Uint8Array>;
    duplex?: "half";
  },
) => Promise<Response>;

export function createS3Storage(options: S3StorageOptions): SigningStorageDriver {
  const fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const signer = createS3Signer(options);

  return {
    driver: "s3",

    async put(source: BlobSource): Promise<PutResult> {
      const staged = await stageUpload(source);
      const key = signer.keyOf(staged.hash);
      try {
        // A zero-byte object is sent as a buffer: Node's fetch does not need a stream body
        // (or duplex) for it, and a streamed empty body is the one shape some proxies reject.
        const body =
          staged.size === 0
            ? new Uint8Array(0)
            : (Readable.toWeb(
                createReadStream(staged.path),
              ) as unknown as ReadableStream<Uint8Array>);
        const response = await fetchImpl(urlFor(options, key), {
          method: "PUT",
          headers: {
            ...signer.headers("PUT", key, staged.hash),
            "content-type": "application/octet-stream",
            "content-length": String(staged.size),
          },
          body,
          ...(staged.size === 0 ? {} : { duplex: "half" as const }),
        });
        if (!response.ok) {
          throw new StorageError("s3: PUT " + key + " failed with HTTP " + response.status);
        }
        return { hash: staged.hash, size: staged.size };
      } finally {
        await unlink(staged.path).catch(() => {});
      }
    },

    async get(hash: string): Promise<BlobSource> {
      if (!isContentHash(hash)) throw new StorageError("invalid content hash");
      const key = signer.keyOf(hash);
      const response = await fetchImpl(urlFor(options, key), {
        method: "GET",
        headers: signer.headers("GET", key, EMPTY_PAYLOAD_SHA256),
      });
      if (!response.ok) {
        throw new StorageError("s3: GET " + key + " failed with HTTP " + response.status);
      }
      if (response.body === null) throw new StorageError("s3: GET " + key + " returned no body");
      return readWebStream(response.body);
    },

    async exists(hash: string): Promise<boolean> {
      if (!isContentHash(hash)) return false;
      const key = signer.keyOf(hash);
      const response = await fetchImpl(urlFor(options, key), {
        method: "HEAD",
        headers: signer.headers("HEAD", key, EMPTY_PAYLOAD_SHA256),
      });
      if (response.status === 404) return false;
      if (!response.ok) {
        throw new StorageError("s3: HEAD " + key + " failed with HTTP " + response.status);
      }
      return true;
    },

    async delete(hash: string): Promise<void> {
      if (!isContentHash(hash)) throw new StorageError("invalid content hash");
      const key = signer.keyOf(hash);
      const response = await fetchImpl(urlFor(options, key), {
        method: "DELETE",
        headers: signer.headers("DELETE", key, EMPTY_PAYLOAD_SHA256),
      });
      if (!response.ok && response.status !== 404) {
        throw new StorageError("s3: DELETE " + key + " failed with HTTP " + response.status);
      }
    },

    signedGetUrl(hash: string, urlOptions?: SignedGetUrlOptions): Promise<string> {
      return signer.signedGetUrl(hash, urlOptions);
    },
  };
}

/** Stage a stream to a 0600 temp file while hashing and counting it (SigV4 payload facts). */
async function stageUpload(
  source: BlobSource,
): Promise<{ path: string; hash: string; size: number }> {
  const path = join(tmpdir(), "facilis-s3-" + randomBytes(12).toString("hex"));
  const hash = createHash("sha256");
  let size = 0;
  // pipeline closes the fd before the catch unlinks, so an early source error cannot
  // leave a /tmp/facilis-s3-* orphan (D-117 review fix).
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.from(source), meter, createWriteStream(path, { mode: 0o600 }));
  } catch (error) {
    await unlink(path).catch(() => {});
    throw error instanceof StorageError
      ? error
      : new StorageError("s3: upload staging failed", { cause: error });
  }
  return { path, hash: hash.digest("hex"), size };
}

function readWebStream(body: ReadableStream<Uint8Array>): BlobSource {
  return (async function* readBody(): AsyncGenerator<Uint8Array> {
    const readable = Readable.fromWeb(body as NodeWebReadableStream<Uint8Array>);
    for await (const chunk of readable) yield new Uint8Array(chunk as Buffer);
  })();
}

function urlFor(options: S3StorageOptions, key: string): string {
  const pathStyle = options.forcePathStyle ?? options.endpoint !== undefined;
  const origin = baseOrigin(options, pathStyle);
  return (
    origin + (pathStyle ? "/" + options.bucket + "/" + encodePath(key) : "/" + encodePath(key))
  );
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

function encodePath(path: string): string {
  return path
    .split("/")
    .map((part) =>
      encodeURIComponent(part).replace(
        /[!'()*]/g,
        (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
      ),
    )
    .join("/");
}
