import { createHash, createHmac } from "node:crypto";

import { isContentHash } from "./hash.ts";
import { StorageError, type SignedGetUrlOptions } from "./types.ts";

/**
 * SigV4 for the S3 driver (D-053), kept apart from the driver so both stay reviewable and
 * under the line limit. No AWS SDK: the calls we need are five, and the framework runtime
 * must stay light.
 */
const SERVICE = "s3";
const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 604_800;

/** SHA-256 of the empty payload, used for GET/HEAD/DELETE signatures. */
export const EMPTY_PAYLOAD_SHA256 = sha256Hex("");

export interface S3SigningOptions {
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly endpoint?: string;
  readonly forcePathStyle?: boolean;
  readonly now?: () => Date;
}

export interface S3Signer {
  /** Blob object key inside the bucket. */
  readonly keyOf: (hash: string) => string;
  /** Signed request headers for a header-authenticated request. */
  readonly headers: (
    method: "PUT" | "GET" | "HEAD" | "DELETE",
    key: string,
    payloadHash: string,
  ) => Record<string, string>;
  /** Time-limited direct-download URL (presigned query signature). */
  readonly signedGetUrl: (hash: string, options?: SignedGetUrlOptions) => Promise<string>;
}

export function createS3Signer(options: S3SigningOptions): S3Signer {
  const now = options.now ?? (() => new Date());
  const pathStyle = options.forcePathStyle ?? options.endpoint !== undefined;
  const origin = baseOrigin(options, pathStyle);
  const host = new URL(origin).host;
  const keyOf = (hash: string) => "blobs/" + hash;
  const pathOf = (key: string) =>
    pathStyle ? "/" + options.bucket + "/" + encodePath(key) : "/" + encodePath(key);

  const urlFor = (key: string, query: Record<string, string> = {}): string => {
    const search = encodeQuery(query);
    return origin + pathOf(key) + (search === "" ? "" : "?" + search);
  };

  const headers = (
    method: "PUT" | "GET" | "HEAD" | "DELETE",
    key: string,
    payloadHash: string,
  ): Record<string, string> => {
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
    const result: Record<string, string> = {
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
    if (options.sessionToken !== undefined) result["x-amz-security-token"] = options.sessionToken;
    return result;
  };

  const signedGetUrl = async (
    hash: string,
    urlOptions: SignedGetUrlOptions = {},
  ): Promise<string> => {
    if (!isContentHash(hash)) throw new StorageError("invalid content hash");
    const ttl = Math.min(
      Math.max(Math.trunc(urlOptions.expiresInSeconds ?? DEFAULT_TTL_SECONDS), 1),
      MAX_TTL_SECONDS,
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
  };

  return { keyOf, headers, signedGetUrl };
}

function sign(
  canonicalRequest: string,
  amzDate: string,
  scope: string,
  options: S3SigningOptions,
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

function baseOrigin(options: S3SigningOptions, pathStyle: boolean): string {
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
