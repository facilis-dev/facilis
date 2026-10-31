import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed download tokens (D-053).
 *
 * A route checks access to a file (owner, or the entity it is attached to) and then signs
 * a short-lived token. The proxy route validates the token and streams the blob. GET is
 * token-only so img tags and shared links work without a cookie; mutations always go
 * through the session, never a token. The token is not encrypted: file id, tenant, subject
 * and expiry are readable, but any change invalidates the signature.
 */
export interface FileTokenPayload {
  readonly fileId: string;
  /** Expiry as epoch milliseconds. */
  readonly expiresAt: number;
  readonly tenantId?: string;
  /** Issuer/subject for audit; optional. */
  readonly subject?: string;
}

const MAX_TTL_SECONDS = 60 * 60 * 24;

export function signDownloadToken(payload: FileTokenPayload, secret: string): string {
  if (!secret) throw new Error("signDownloadToken: a non-empty secret is required");
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return body + "." + hmac(body, secret);
}

/** Verify a token: signature first, then expiry. Returns null for anything invalid. */
export function verifyDownloadToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): FileTokenPayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(signature, hmac(body, secret))) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!isPayload(parsed) || parsed.expiresAt <= now) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Build the signed URL path a browser can fetch directly (default /api/files). */
export function buildSignedDownloadUrl(input: {
  fileId: string;
  secret: string;
  basePath?: string;
  expiresInSeconds?: number;
  tenantId?: string;
  subject?: string;
  now?: number;
}): string {
  const ttl = Math.min(Math.max(Math.trunc(input.expiresInSeconds ?? 300), 1), MAX_TTL_SECONDS);
  const now = input.now ?? Date.now();
  const token = signDownloadToken(
    {
      fileId: input.fileId,
      expiresAt: now + ttl * 1000,
      tenantId: input.tenantId,
      subject: input.subject,
    },
    input.secret,
  );
  const base = (input.basePath ?? "/api/files").replace(/\/+$/, "");
  return base + "/" + encodeURIComponent(input.fileId) + "?token=" + encodeURIComponent(token);
}

function isPayload(value: unknown): value is FileTokenPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.fileId === "string" &&
    typeof record.expiresAt === "number" &&
    (record.tenantId === undefined || typeof record.tenantId === "string") &&
    (record.subject === undefined || typeof record.subject === "string")
  );
}

function hmac(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
