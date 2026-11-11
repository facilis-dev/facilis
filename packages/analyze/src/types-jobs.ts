// Background-job fact model, split from types.ts so the base fact model stays under the
// 300-line source limit. A job always runs system-scoped (D-107), so D-157 applies to its
// `db` client without the elevation dimension routes have: no `ctx.sudo`/`ctx.system`.

import type { RouteRelationUse } from "./types-relations.ts";
import type { SourceRef, UnknownFact } from "./types.ts";

/** One `server/jobs/**` definition: the `defineJob({...})` default export. */
export interface JobFact {
  readonly name: string;
  readonly sourceFile: string;
  readonly source: SourceRef;
  /** Relations the definition declares; null when not statically readable (D-157). */
  readonly dbTables: readonly string[] | null;
  /** true allows `db.execute`; false when absent; null when unreadable (fail closed). */
  readonly rawSql: boolean | null;
  readonly unknown: readonly UnknownFact[];
}

/** Static db usage of one job's `run(ctx)` body, following project-local calls (D-157). */
export interface JobRelationsFact {
  readonly used: readonly RouteRelationUse[];
  readonly unresolved: readonly SourceRef[];
  /** `db.execute(...)` call sites; legal only with rawSql: true. */
  readonly rawSql: readonly SourceRef[];
  /** A project-external callee received the job's db client, so usage is incomplete. */
  readonly opaque: boolean;
}

/**
 * Usage of a job whose `run` the pass cannot inspect: explicitly empty, never guessed.
 * `opaque` is true because "not observed" must not be reported as "never used" (the
 * declared-but-unused warning and the AI rule both suppress on it).
 */
export const EMPTY_JOB_RELATIONS: JobRelationsFact = {
  used: [],
  unresolved: [],
  rawSql: [],
  opaque: true,
};
