import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import { eq } from "drizzle-orm";

import {
  DEFAULT_TENANT_ID,
  fail,
  type AuthContext,
  type FacilisHandlerEvent,
  type StorageApi,
} from "@facilis/core";
import { facilisFiles, type PolicyScopedDatabase } from "@facilis/db";

/**
 * Route-facing helpers for binary uploads (D-053, SPEC §5.10).
 *
 * The framework stores the bytes and the `facilis_files` metadata; the app's own route
 * declares the permissions, decides which entity the file belongs to and inserts the
 * generated link row (`fileLinks`). The download route is token-only, so it can stay a
 * public route (`permission: []`) and serve `<img>`/shared links without a cookie.
 */
export interface StoredFile {
  readonly id: string;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  /** Signed, app-relative download URL (default TTL: storage.tokenTtlSeconds). */
  readonly url: string;
}

export interface StoreUploadInput {
  readonly event: FacilisHandlerEvent;
  readonly db: PolicyScopedDatabase;
  readonly storage: StorageApi;
  readonly auth: AuthContext | null;
  readonly file: File;
}

export interface SendStoredFileInput {
  readonly db: PolicyScopedDatabase;
  readonly storage: StorageApi;
  readonly fileId: string;
  readonly token: string;
  readonly tenantId?: string;
  /** Override the `content-disposition` filename (defaults to the stored name). */
  readonly responseName?: string;
}

const DEFAULT_FILE_NAME = "file";
const MAX_FILE_NAME = 180;
const DEFAULT_MIME = "application/octet-stream";
const SAFE_MIME = /^[\w.+-]+\/[\w.+-]+$/;

/** Store the uploaded bytes and their metadata row; the caller inserts the link row. */
export async function storeUpload(input: StoreUploadInput): Promise<StoredFile | Response> {
  const { event, db, storage, auth, file } = input;
  if (!storage.available) return fail("storage_unavailable");
  if (auth === null) return fail("unauthorized");
  // Reject before reading the body into memory: the limit is the framework's, not the UI's.
  if (file.size > storage.maxUploadBytes) {
    return fail("file_too_large", { maxBytes: storage.maxUploadBytes, size: file.size });
  }

  const name = sanitizeFileName(file.name);
  const mime = sanitizeMime(file.type);
  // Stream the multipart file straight into storage (D-117): no full-file buffer here.
  const put = await storage.put(
    Readable.fromWeb(file.stream() as unknown as WebReadableStream<Uint8Array>),
  );
  const [row] = await db
    .insert(facilisFiles)
    .values({ hash: put.hash, name, mime, size: put.size, ownerId: auth.userId })
    .returning({ id: facilisFiles.id });
  if (row === undefined) return fail("internal_error");

  const tenantId = event.context.facilis?.defaultTenantId ?? DEFAULT_TENANT_ID;
  return {
    id: row.id,
    name,
    mime,
    size: put.size,
    url: storage.buildDownloadUrl(row.id, { tenantId, subject: auth.userId }),
  };
}

/**
 * Validate the signed token, load the metadata row and return the bytes.
 *
 * The token binds the file id (and optionally the tenant); the row lookup runs under the
 * request's policy scope, so a token from another deployment cannot reach a foreign row.
 * Production streams through a driver-presigned redirect when the driver supports it.
 */
export async function sendStoredFile(input: SendStoredFileInput): Promise<Response> {
  const { db, storage, fileId, token, tenantId } = input;
  if (!storage.available) return fail("storage_unavailable");

  const payload = storage.verifyDownloadToken(token, fileId);
  if (payload === null) return fail("not_found");
  if (payload.tenantId !== undefined && tenantId !== undefined && payload.tenantId !== tenantId) {
    return fail("not_found");
  }

  const [row] = await db
    .select({
      hash: facilisFiles.hash,
      name: facilisFiles.name,
      mime: facilisFiles.mime,
      size: facilisFiles.size,
    })
    .from(facilisFiles)
    .where(eq(facilisFiles.id, fileId))
    .limit(1);
  if (row === undefined) return fail("not_found");

  const name = sanitizeFileName(input.responseName ?? row.name);
  if (storage.presignedGetUrl !== undefined) {
    const location = await storage.presignedGetUrl(row.hash, { responseName: name });
    return new Response(null, { status: 302, headers: { location } });
  }

  // Stream the plaintext straight into the response: the size header comes from the
  // metadata row, so neither encrypted nor plaintext downloads are ever buffered whole.
  const source = await storage.get(row.hash);
  const body = Readable.toWeb(Readable.from(source)) as unknown as ConstructorParameters<
    typeof Response
  >[0];
  return new Response(body, {
    status: 200,
    headers: fileHeaders(sanitizeMime(row.mime), name, row.size),
  });
}

/** Headers that make a user-uploaded blob safe to serve from the app origin. */
export function fileHeaders(mime: string, name: string, length: number): Headers {
  return new Headers({
    "content-type": mime,
    "content-length": String(length),
    // Never render an uploaded HTML/SVG document on the app origin; attachment downloads
    // still work for links, and <img> subresources ignore the disposition.
    "content-disposition": contentDisposition(name),
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox",
    "cache-control": "private, max-age=60",
  });
}

/** Strip path separators/control characters; keep the display name users already saw. */
export function sanitizeFileName(value: string): string {
  const base = value.split(/[\\/]/).pop() ?? "";
  const cleaned = stripControlCharacters(base).trim().slice(0, MAX_FILE_NAME);
  return cleaned.length === 0 ? DEFAULT_FILE_NAME : cleaned;
}

/** Drop C0 controls and DEL without a control-character regex (lint forbids one). */
function stripControlCharacters(value: string): string {
  let out = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) out += character;
  }
  return out;
}

/** Only a syntactically valid MIME type is echoed back; anything else is octet-stream. */
export function sanitizeMime(value: string): string {
  return SAFE_MIME.test(value) ? value.toLowerCase() : DEFAULT_MIME;
}

function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
