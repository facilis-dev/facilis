/**
 * Rule 22 `raw-sql-system-table-write` (SPEC §8.4/§9.3, D-214): a literal raw SQL write must
 * not target a seed-only auth table. `role_permissions`, `roles`, `user_roles` and `sessions`
 * are written only by the release artifact's seed statements and the framework's audited auth
 * paths (D-158/D-204); `ctx.sudo`/`ctx.system` + `rawSql: true` can still reach them, so the
 * validator flags the literal statement before it reaches disk.
 *
 * The rule reads the effective post-patch Analysis' `rawSqlStatements` facts (recorded by the
 * relation walk), never a re-parse of the patch. A statement the walk could not read is absent
 * from the fact, so dynamic SQL is skipped and the runtime audit remains the authority.
 */

import { rawSqlSystemWriteSites, type RawSqlUsage } from "@facilis.dev/analyze";

import type { EffectiveState } from "../overlay.ts";
import type { ValidationError } from "../types.ts";

export const RAW_SQL_SYSTEM_TABLE_WRITE_RULE = "raw-sql-system-table-write";

function finding(file: string, line: number, verb: string, table: string): ValidationError {
  return {
    rule: RAW_SQL_SYSTEM_TABLE_WRITE_RULE,
    severity: "error",
    file,
    line,
    message:
      "Raw SQL " +
      verb +
      ' writes the system-only auth table "' +
      table +
      '"; app code must not write it.',
    fix_hint:
      "Remove the write: role_permissions, roles, user_roles and sessions are written only by the release seed (SPEC §8.4, D-158/D-204).",
  };
}

/** Rule 22 over the effective analysis (invariant 8, D-214). */
export function rawSqlSystemTableWriteErrors(state: EffectiveState): ValidationError[] {
  // A hand-built analysis may predate the relation facts (IDE snapshots): no facts, no check.
  const usages: RawSqlUsage[] = [
    ...state.analysis.routes
      .map((route) => route.relations)
      .filter((usage) => usage !== undefined),
    ...Object.values(state.analysis.jobRelations ?? {}),
  ];
  return rawSqlSystemWriteSites(usages).map((site) =>
    finding(site.source.file, site.source.line, site.verb, site.table),
  );
}
