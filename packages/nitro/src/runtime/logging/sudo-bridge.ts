import { setSudoAuditSink, type SudoAuditEvent } from "@facilis.dev/db";
import type { AuditLogEntry, FacilisLoggingApi } from "@facilis.dev/core";

/**
 * Bridge the db package's sudo trail into the audit stream (D-099, D-119).
 *
 * The sudo event is the framework's own security record; it becomes one more `audit` entry
 * instead of a parallel `facilis:sudo` stdout protocol. Fail-closed is preserved: the bridge
 * calls `record` synchronously, and a throwing audit sink propagates out of `writeSudoAudit`
 * so sudo refuses to escalate untraced.
 */
export function toSudoAuditEntry(event: SudoAuditEvent): AuditLogEntry {
  return {
    kind: "audit",
    ts: event.at,
    level: "info",
    event: `sudo:${event.event}`,
    actor: event.actor,
    operation: event.operation,
    reason: event.reason,
    tables: event.tables,
    ...(event.observedTables === undefined ? {} : { observedTables: event.observedTables }),
    roles: event.roles,
    ...(event.actorUserId === undefined ? {} : { userId: event.actorUserId }),
    ...(event.sessionHash === undefined ? {} : { sessionHash: event.sessionHash }),
    ...(event.tenantId === undefined ? {} : { tenantId: event.tenantId }),
    ...(event.requestId === undefined ? {} : { requestId: event.requestId }),
    ...(event.method === undefined ? {} : { method: event.method }),
    ...(event.route === undefined ? {} : { path: event.route }),
    ...(event.outcome === undefined ? {} : { outcome: event.outcome }),
    ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
    ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
  };
}

/** Replaces the process-wide sudo sink once, at boot, with the audit stream. */
export function installSudoAuditBridge(logging: FacilisLoggingApi): void {
  setSudoAuditSink((event) => {
    logging.record(toSudoAuditEntry(event));
  });
}
