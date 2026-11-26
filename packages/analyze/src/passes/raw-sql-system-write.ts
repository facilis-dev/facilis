/**
 * D-214 diagnostic: a literal `db.execute` write against a seed-only auth table is an early
 * warning, not a runtime boundary (invariant 8, D-158/D-204). Only statements the relation walk
 * could read are considered; dynamic/unreadable SQL is absent from the fact and never guessed.
 * Framework seed statements are shipped code (node_modules) and stay exempt.
 */

import { error } from "../diagnostics.ts";
import {
  rawSqlSystemWriteSites,
  type RawSqlSystemWriteSite,
  type RawSqlUsage,
} from "../raw-sql-system-tables.ts";
import type { Diagnostic } from "../types.ts";

const CODE = "raw-sql-system-write";

function message(site: RawSqlSystemWriteSite): string {
  return (
    'raw SQL ' +
    site.verb +
    ' writes the system-only auth table "' +
    site.table +
    '"; it is written only by the release seed (SPEC §8.4, D-158/D-204)'
  );
}

/** Every literal system-table write in the given route/job usages (SPEC §8.4, D-214). */
export function rawSqlSystemWriteDiagnostics(usages: readonly RawSqlUsage[]): Diagnostic[] {
  return rawSqlSystemWriteSites(usages).map((site) => error(CODE, message(site), site.source));
}
