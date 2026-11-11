/**
 * Sudo audit trail (D-099).
 *
 * A sudo escalation is recorded on a dedicated, append-only sink, never in the database:
 * the trail must survive the transaction rollback it describes, and the framework has no
 * update/delete operation for it. The default sink is stdout (one JSON line per event) so a
 * deploy's log platform can ship it to WORM/retention storage; tests swap the sink.
 *
 * Fail closed: if the sink throws, the escalation must not happen, so writeSudoAudit throws
 * a SudoAuditUnavailableError and the caller refuses to switch roles.
 */

export type SudoAuditEventName = "started" | "succeeded" | "failed";

/** One immutable audit entry. `id` is shared by every entry of the same sudo call. */
export interface SudoAuditEvent {
  readonly event: SudoAuditEventName;
  /** Shared call id; also written to the app.sudo_id GUC while the role is elevated. */
  readonly id: string;
  /** ISO-8601 timestamp of the append (not of the call start). */
  readonly at: string;
  /** Acting user id; absent for a system job (actor is the label). */
  readonly actorUserId?: string;
  /** "user:<id>" for a route session, "system:<job>" for a job/CLI caller. */
  readonly actor: string;
  /** SHA-256 of the session id; the raw cookie/token is never logged. */
  readonly sessionHash?: string;
  readonly roles: readonly string[];
  readonly tenantId?: string;
  /** Request pathname, e.g. "/api/order-requests". */
  readonly route?: string;
  /** Request method, when known. */
  readonly method?: string;
  /** The route's declared permission (the first one), for context. */
  readonly permission?: string;
  readonly operation: string;
  readonly reason: string;
  readonly tables: readonly string[];
  /** Succeeded entries: the declared tables the elevated callback actually reached (D-157). */
  readonly observedTables?: readonly string[];
  readonly requestId?: string;
  /** Terminal entries only: how the elevated block ended. */
  readonly outcome?: "succeeded" | "failed";
  /** Terminal failure entries: canonical code, never the internal message. */
  readonly errorCode?: string;
  readonly durationMs?: number;
}

/** Appends one entry. Synchronous by design: a sink cannot silently promise to log later. */
export type SudoAuditSink = (event: SudoAuditEvent) => void;

/** Thrown when the audit sink is not writable; sudo refuses to escalate untraced. */
export class SudoAuditUnavailableError extends Error {
  readonly code = "sudo_audit_unavailable";

  constructor(cause: unknown) {
    super("The sudo audit sink is not writable; refusing to escalate a database call.", { cause });
    this.name = "SudoAuditUnavailableError";
  }
}

/** New call id: WebCrypto randomUUID (available in Node and the browser VM alike). */
export function newSudoId(): string {
  return globalThis.crypto.randomUUID();
}

const consoleSink: SudoAuditSink = (event): void => {
  // oxlint-disable-next-line no-console -- the default audit sink IS stdout: one JSON line per entry for the deploy's log pipeline.
  console.log("facilis:sudo " + JSON.stringify(event));
};

let sink: SudoAuditSink = consoleSink;

/** Replaces the process-wide sink (tests/tooling). Production leaves the stdout default. */
export function setSudoAuditSink(next: SudoAuditSink): void {
  sink = next;
}

/** Restores the default stdout sink. */
export function resetSudoAuditSink(): void {
  sink = consoleSink;
}

/** Append one entry, failing closed: a broken sink throws instead of dropping the trail. */
export function writeSudoAudit(event: SudoAuditEvent): void {
  try {
    sink(event);
  } catch (cause) {
    throw new SudoAuditUnavailableError(cause);
  }
}
