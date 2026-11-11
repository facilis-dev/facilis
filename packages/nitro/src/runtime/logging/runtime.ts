import {
  logLevelEnabled,
  type AppLogEntry,
  type AuditLogEntry,
  type FacilisLogger,
  type FacilisLoggingApi,
  type FacilisLoggingConfig,
  type FacilisLogRequestMeta,
  type LogEntry,
  type LogLevel,
} from "@facilis.dev/core";

import { sanitizeEntry } from "./entry.ts";
import { createFileLogSink } from "./file-sink.ts";
import { createStdoutLogSink, type LogSink, type LogStream } from "./log-sink.ts";
import type { LogSettingsWarning, ResolvedLogSettings } from "./log-settings.ts";

/**
 * The logging runtime behind `event.context.facilis.logging` (D-119).
 *
 * `record` is the one pipeline: it filters by the project's logging config, redacts/caps and
 * writes to the env-selected sinks. Audit is never filtered and never best-effort: a failed
 * audit write throws so sudo refuses to escalate (D-099), while a broken access/error/app sink
 * only drops entries and reports once.
 */
export interface LoggingRuntimeOptions {
  readonly config: FacilisLoggingConfig;
  readonly settings: ResolvedLogSettings;
  /** Test/deployment seam: collect stdout lines instead of writing to the process stream. */
  readonly writeStdout?: (line: string) => void;
  /** Test seam: fixed clock. */
  readonly now?: () => Date;
}

export interface LoggingRuntime extends FacilisLoggingApi {
  readonly config: FacilisLoggingConfig;
  readonly settings: ResolvedLogSettings;
  /** Non-fatal setup problems the bootstrap forwards to the manifest. */
  readonly warnings: readonly LogSettingsWarning[];
}

interface LogIdentity {
  readonly userId?: string;
  readonly sessionHash?: string;
  readonly tenantId?: string;
  readonly ip?: string;
}

export function createLoggingRuntime(options: LoggingRuntimeOptions): LoggingRuntime {
  const warnings: LogSettingsWarning[] = [];
  let file: LogSink | null = null;
  if (options.settings.sinks.file) {
    const setup = createFileLogSink({
      dir: options.settings.dir,
      maxBytes: options.settings.maxBytes,
      keep: options.settings.keep,
    });
    warnings.push(...setup.warnings);
    file = setup.sink;
  }
  const stdout: LogSink | null = options.settings.sinks.stdout
    ? createStdoutLogSink(options.writeStdout)
    : null;
  const now = options.now ?? (() => new Date());
  let reportedWriteFailure = false;

  const reportWriteFailure = (error: unknown): void => {
    if (reportedWriteFailure) return;
    reportedWriteFailure = true;
    // One line per process: a broken sink would otherwise flood the terminal with the very
    // entries it cannot store. Audit does not come through here: it fails the request instead.
    // oxlint-disable-next-line no-console -- operator fallback for the best-effort streams.
    console.error("facilis: log sink is not writable; dropping access/error/app entries", error);
  };

  const write = (stream: LogStream, entry: LogEntry): void => {
    try {
      file?.append(stream, entry);
      stdout?.append(stream, entry);
    } catch (error) {
      if (stream === "audit") throw error;
      reportWriteFailure(error);
    }
  };

  const accepts = (entry: LogEntry): boolean => {
    switch (entry.kind) {
      case "audit":
        // Never filtered: an audit trail with holes is not an audit trail.
        return true;
      case "access":
        return options.config.access && logLevelEnabled(options.config.level, entry.level);
      case "error":
        return options.config.errors;
      case "app":
        return logLevelEnabled(options.config.level, entry.level);
    }
  };

  const record = (entry: LogEntry): void => {
    if (!accepts(entry)) return;
    write(entry.kind, sanitizeEntry(entry));
  };

  const logger = (meta: FacilisLogRequestMeta): FacilisLogger => {
    const identity = buildIdentity(meta);
    const app =
      (level: LogLevel) =>
      (message: string, data?: Record<string, unknown>): void => {
        const entry: AppLogEntry = {
          kind: "app",
          ts: now().toISOString(),
          level,
          requestId: meta.requestId,
          message,
          method: meta.method,
          path: meta.path,
          ...(data === undefined ? {} : { data }),
          ...identity,
        };
        record(entry);
      };
    return {
      debug: app("debug"),
      info: app("info"),
      warn: app("warn"),
      error: app("error"),
      audit: (input) => {
        // The actor is derived, never caller-supplied: "anonymous" is the session-less case
        // (a public route or a boot-time event), not a claim about identity.
        const actor = meta.userId === undefined ? "anonymous" : `user:${meta.userId}`;
        const entry: AuditLogEntry = {
          kind: "audit",
          ts: now().toISOString(),
          level: "info",
          event: input.operation,
          actor,
          requestId: meta.requestId,
          method: meta.method,
          path: meta.path,
          ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
          ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(input.tables === undefined ? {} : { tables: input.tables }),
          ...(input.details === undefined ? {} : { details: input.details }),
          ...identity,
        };
        record(entry);
      },
    };
  };

  return { record, logger, config: options.config, settings: options.settings, warnings };
}

function buildIdentity(meta: FacilisLogRequestMeta): LogIdentity {
  return {
    ...(meta.userId === undefined ? {} : { userId: meta.userId }),
    ...(meta.sessionHash === undefined ? {} : { sessionHash: meta.sessionHash }),
    ...(meta.tenantId === undefined ? {} : { tenantId: meta.tenantId }),
    ...(meta.ip === undefined ? {} : { ip: meta.ip }),
  };
}
