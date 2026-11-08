/**
 * Logging contract (SPEC §8.7, D-119).
 *
 * The framework emits three operator-facing streams from one append-only pipeline: access
 * (one entry per authorized request), error (a server-side failure, never the client body)
 * and audit (security-relevant events; the sudo trail is part of it). A route may add its
 * own diagnostic lines and audit events through `ctx.log`.
 *
 * Core owns the SHAPES only. The sink (stdout/file), redaction, rotation, retention and the
 * dev buffer live in @facilis/nitro's runtime, because they are deployment concerns (D-119):
 * a generated project must not be able to widen what an operator's log platform receives.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LOG_LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && (LOG_LEVELS as readonly string[]).includes(value);
}

/** `true` when an entry at `level` passes a sink configured at `threshold`. */
export function logLevelEnabled(threshold: LogLevel, level: LogLevel): boolean {
  return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[threshold];
}

export const LOG_KINDS = ["access", "audit", "error", "app"] as const;
export type LogKind = (typeof LOG_KINDS)[number];

/** Fields every entry carries; `requestId` is absent only for boot-time/system events. */
export interface LogEntryMeta {
  /** ISO-8601 timestamp of the append. */
  readonly ts: string;
  readonly level: LogLevel;
  readonly requestId?: string;
  /** Acting user id; never the email or another direct identifier. */
  readonly userId?: string;
  /** SHA-256 of the session id (D-099); the raw cookie is never logged. */
  readonly sessionHash?: string;
  readonly tenantId?: string;
  readonly ip?: string;
}

/** One access entry per authorized request, written when the response is ready. */
export interface AccessLogEntry extends LogEntryMeta {
  readonly kind: "access";
  readonly requestId: string;
  readonly method: string;
  /** Pathname only: query strings can carry tokens and are never logged. */
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  readonly userAgent?: string;
}

/** A server-side failure. The client still receives the canonical code, never this entry. */
export interface ErrorLogEntry extends LogEntryMeta {
  readonly kind: "error";
  readonly requestId: string;
  readonly code: string;
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly method?: string;
  readonly path?: string;
}

/**
 * An audit event. Framework events use a namespaced label ("sudo:started",
 * "auth:sso:login") and `operation` for the elevated work; app events use the operation the
 * route declared ("order-request:cancel") directly.
 */
export interface AuditLogEntry extends LogEntryMeta {
  readonly kind: "audit";
  readonly event: string;
  readonly actor: string;
  readonly operation?: string;
  readonly outcome?: "succeeded" | "failed";
  readonly errorCode?: string;
  readonly durationMs?: number;
  readonly method?: string;
  readonly path?: string;
  readonly tables?: readonly string[];
  readonly roles?: readonly string[];
  readonly reason?: string;
  readonly details?: Record<string, unknown>;
}

/** A diagnostic line written by application code through `ctx.log`. */
export interface AppLogEntry extends LogEntryMeta {
  readonly kind: "app";
  readonly requestId: string;
  readonly message: string;
  readonly data?: Record<string, unknown>;
  readonly method?: string;
  readonly path?: string;
}

export type LogEntry = AccessLogEntry | ErrorLogEntry | AuditLogEntry | AppLogEntry;

/** What `ctx.log.audit` accepts: a stable operation label, never user input. */
export interface FacilisAuditInput {
  readonly operation: string;
  readonly outcome?: "succeeded" | "failed";
  readonly errorCode?: string;
  readonly reason?: string;
  readonly tables?: readonly string[];
  readonly details?: Record<string, unknown>;
}

/** The per-request logger carried by the handler context (SPEC §7.4). */
export interface FacilisLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  /** Appends an audit entry now; audit is not filtered by the diagnostic level. */
  audit(event: FacilisAuditInput): void;
}

/** Request facts every stream shares. Built once by the route wrapper. */
export interface FacilisLogRequestMeta {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly userId?: string;
  readonly sessionHash?: string;
  readonly tenantId?: string;
  readonly ip?: string;
  readonly userAgent?: string;
}

/**
 * The logging runtime attached to `event.context.facilis.logging` (D-119). Core only calls
 * it; it must never throw into the request path (logging cannot fail a response).
 */
export interface FacilisLoggingApi {
  readonly record: (entry: LogEntry) => void;
  readonly logger: (meta: FacilisLogRequestMeta) => FacilisLogger;
}

const noop = (): void => {
  // The no-op logger is the contract's safe default when no runtime is attached (tests and
  // standalone wrappers); it intentionally has no side effect.
};

export const NOOP_LOGGER: FacilisLogger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  audit: noop,
};

export const NOOP_LOGGING_API: FacilisLoggingApi = {
  record: noop,
  logger: () => NOOP_LOGGER,
};

/** Header/origin values are attacker-controlled: accept only a plain correlation token. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

/** Returns the caller's request id when it is safe to echo/correlate, else null. */
export function acceptRequestId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  return REQUEST_ID_PATTERN.test(value) ? value : null;
}

/** New correlation id (WebCrypto is present in Node and the browser VM alike). */
export function newLogRequestId(): string {
  return globalThis.crypto.randomUUID();
}

/** Pathname from a request URL; malformed URLs degrade to "/" instead of failing a route. */
export function requestPath(url: string | undefined): string {
  if (typeof url !== "string" || url.length === 0) return "/";
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return "/";
  }
}

function identity(meta: FacilisLogRequestMeta): Partial<LogEntryMeta> {
  return {
    ...(meta.userId === undefined ? {} : { userId: meta.userId }),
    ...(meta.sessionHash === undefined ? {} : { sessionHash: meta.sessionHash }),
    ...(meta.tenantId === undefined ? {} : { tenantId: meta.tenantId }),
    ...(meta.ip === undefined ? {} : { ip: meta.ip }),
  };
}

export interface AccessLogInput {
  readonly status: number;
  readonly durationMs: number;
  readonly userAgent?: string;
}

/** Builds the access entry for the request described by `meta`. */
export function createAccessEntry(
  meta: FacilisLogRequestMeta,
  input: AccessLogInput,
): AccessLogEntry {
  return {
    kind: "access",
    ts: new Date().toISOString(),
    level: "info",
    requestId: meta.requestId,
    method: meta.method,
    path: meta.path,
    status: input.status,
    durationMs: input.durationMs,
    ...identity(meta),
    ...(meta.userAgent === undefined ? {} : { userAgent: meta.userAgent }),
  };
}

/** Builds the server-side error entry for an unexpected handler failure. */
export function createErrorEntry(
  meta: FacilisLogRequestMeta,
  error: unknown,
  code: string,
): ErrorLogEntry {
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  return {
    kind: "error",
    ts: new Date().toISOString(),
    level: "error",
    requestId: meta.requestId,
    code,
    name,
    message,
    ...(stack === undefined ? {} : { stack }),
    method: meta.method,
    path: meta.path,
    ...identity(meta),
  };
}
