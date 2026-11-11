import type {
  AccessLogEntry,
  AppLogEntry,
  AuditLogEntry,
  ErrorLogEntry,
  LogEntry,
} from "@facilis.dev/core";

import { capString, redactRecord } from "./redact.ts";

/**
 * Entry sanitization at the sink boundary (D-119).
 *
 * Core builds the entry shapes; this pass makes them safe to serialize: every free-text field
 * is capped, and the only arbitrary payloads (`data`/`details`) are redacted. Strings are
 * capped rather than truncated with a marker so a hostile value cannot grow a line.
 */
export const MAX_LOG_MESSAGE = 1000;
export const MAX_LOG_STACK = 4000;
export const MAX_LOG_FIELD = 1000;
export const MAX_LOG_SHORT = 200;
export const MAX_LOG_ARRAY = 50;

export function sanitizeEntry(entry: LogEntry): LogEntry {
  switch (entry.kind) {
    case "access":
      return sanitizeAccess(entry);
    case "error":
      return sanitizeError(entry);
    case "audit":
      return sanitizeAudit(entry);
    case "app":
      return sanitizeApp(entry);
  }
}

function sanitizeAccess(entry: AccessLogEntry): AccessLogEntry {
  return {
    ...entry,
    path: capString(entry.path, MAX_LOG_FIELD),
    ...(entry.userAgent === undefined
      ? {}
      : { userAgent: capString(entry.userAgent, MAX_LOG_FIELD) }),
    // The client IP comes from an attacker-controlled header when trustProxy is on: cap it
    // or a multi-KB x-forwarded-for would inflate every access line and the file.
    ...(entry.ip === undefined ? {} : { ip: capString(entry.ip, MAX_LOG_SHORT) }),
  };
}

function sanitizeError(entry: ErrorLogEntry): ErrorLogEntry {
  return {
    ...entry,
    code: capString(entry.code, MAX_LOG_SHORT),
    name: capString(entry.name, MAX_LOG_SHORT),
    message: capString(entry.message, MAX_LOG_MESSAGE),
    ...(entry.stack === undefined ? {} : { stack: capString(entry.stack, MAX_LOG_STACK) }),
    ...(entry.method === undefined ? {} : { method: capString(entry.method, MAX_LOG_SHORT) }),
    ...(entry.path === undefined ? {} : { path: capString(entry.path, MAX_LOG_FIELD) }),
    requestId: capString(entry.requestId, MAX_LOG_SHORT),
    ...(entry.ip === undefined ? {} : { ip: capString(entry.ip, MAX_LOG_SHORT) }),
  };
}

function sanitizeAudit(entry: AuditLogEntry): AuditLogEntry {
  return {
    ...entry,
    event: capString(entry.event, MAX_LOG_SHORT),
    actor: capString(entry.actor, MAX_LOG_SHORT),
    ...(entry.operation === undefined
      ? {}
      : { operation: capString(entry.operation, MAX_LOG_FIELD) }),
    ...(entry.errorCode === undefined
      ? {}
      : { errorCode: capString(entry.errorCode, MAX_LOG_SHORT) }),
    ...(entry.reason === undefined ? {} : { reason: capString(entry.reason, MAX_LOG_MESSAGE) }),
    ...(entry.method === undefined ? {} : { method: capString(entry.method, MAX_LOG_SHORT) }),
    ...(entry.path === undefined ? {} : { path: capString(entry.path, MAX_LOG_FIELD) }),
    ...(entry.tables === undefined ? {} : { tables: capList(entry.tables) }),
    ...(entry.roles === undefined ? {} : { roles: capList(entry.roles) }),
    ...(entry.details === undefined ? {} : { details: redactRecord(entry.details) }),
    ...(entry.ip === undefined ? {} : { ip: capString(entry.ip, MAX_LOG_SHORT) }),
  };
}

function sanitizeApp(entry: AppLogEntry): AppLogEntry {
  return {
    ...entry,
    message: capString(entry.message, MAX_LOG_MESSAGE),
    ...(entry.data === undefined ? {} : { data: redactRecord(entry.data) }),
    ...(entry.method === undefined ? {} : { method: capString(entry.method, MAX_LOG_SHORT) }),
    ...(entry.path === undefined ? {} : { path: capString(entry.path, MAX_LOG_FIELD) }),
    ...(entry.ip === undefined ? {} : { ip: capString(entry.ip, MAX_LOG_SHORT) }),
  };
}

function capList(values: readonly string[] | undefined): readonly string[] | undefined {
  if (values === undefined) return undefined;
  return values.slice(0, MAX_LOG_ARRAY).map((value) => capString(value, MAX_LOG_FIELD));
}
