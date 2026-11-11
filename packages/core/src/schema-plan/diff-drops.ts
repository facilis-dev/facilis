import type { PolicySnapshot, TableSnapshot } from "@facilis.dev/db";

import { addDraft, columnsByName, isScoped, removedTables, survivingTables, type PlanContext } from "./diff-helpers.ts";
import { slug } from "./draft.ts";
import { addProblem } from "./problems.ts";
import {
  dropConstraintSql,
  dropIndexSql,
  dropPolicySql,
  foreignKeyName,
  foreignKeySignature,
  sameIndex,
  samePolicy,
  sameStringArray,
  sortedChecks,
  sortedForeignKeys,
  sortedIndexes,
  sortedPolicies,
  sortedUniqueConstraints,
  uniqueName,
} from "./render.ts";

/**
 * Phase 1: drop obsolete policies/constraints/indexes that must change, and every
 * dependent object of a table or column that disappears later (phase 9). Drops always run
 * before the destructive batch, so DROP TABLE/COLUMN never needs CASCADE.
 */
export function planObsoleteDrops(context: PlanContext): void {
  dropForeignKeys(context);
  dropPolicies(context);
  dropConstraints(context);
  dropIndexes(context);
  dropRemovedTableDependencies(context);
}

/** FKs that disappear (including those referencing a dropped table) are dropped first. */
function dropForeignKeys(context: PlanContext): void {
  for (const table of survivingTables(context)) {
    const previous = context.fromTables.get(table.name);
    if (previous === undefined) continue;
    const kept = new Set(table.foreignKeys.map(foreignKeySignature));
    for (const foreignKey of sortedForeignKeys(previous.foreignKeys)) {
      if (kept.has(foreignKeySignature(foreignKey))) continue;
      addDraft(context, {
        slug: slug("drop-fk", table.name, foreignKey.columns.join("_")),
        sql: dropConstraintSql(table.name, foreignKeyName(table.name, foreignKey)),
        risk: "careful",
      });
    }
  }
}

/**
 * A policy that disappears from a scoped table is a security regression (D-136): there is
 * no replacement, so the release fails. A changed policy is dropped here and recreated in
 * phase 6 — by name it is a replacement.
 */
function dropPolicies(context: PlanContext): void {
  for (const table of survivingTables(context)) {
    const previous = context.fromTables.get(table.name);
    if (previous === undefined) continue;
    const next = new Map(table.policies.map((policy) => [policy.name, policy]));
    for (const policy of sortedPolicies(previous.policies)) {
      const replacement = next.get(policy.name);
      if (replacement === undefined) {
        dropRemovedPolicy(context, table, previous, policy.name);
        continue;
      }
      if (samePolicy(policy, replacement)) continue;
      // Broadening is the dangerous direction: on a scoped table, dropping the
      // current_setting('app.*') guard hands rows to every request (D-136).
      if (isScoped(previous) && losesAppScope(policy) && !losesAppScope(replacement)) {
        addProblem(context, "policy_unsafe", { table: table.name, construct: `policy:${policy.name}` });
        continue;
      }
      addDraft(context, {
        slug: slug("drop-policy", table.name, policy.name),
        sql: dropPolicySql(table.name, policy.name),
        risk: "careful",
      });
    }
  }
}

/** True when the policy predicates read the app scope GUCs that RLS depends on. */
function losesAppScope(policy: PolicySnapshot): boolean {
  return mentionsAppScope(policy.using) || mentionsAppScope(policy.withCheck);
}

function mentionsAppScope(predicate: string | null): boolean {
  return predicate !== null && /current_setting\(\s*'app\./i.test(predicate);
}

function dropRemovedPolicy(
  context: PlanContext,
  table: TableSnapshot,
  previous: TableSnapshot,
  policyName: string,
): void {
  if (isScoped(previous)) {
    addProblem(context, "policy_unsafe", { table: table.name, construct: `policy:${policyName}` });
    return;
  }
  addDraft(context, {
    slug: slug("drop-policy", table.name, policyName),
    sql: dropPolicySql(table.name, policyName),
    risk: "careful",
  });
}

/** Removed/redefined unique constraints and checks are dropped here; phase 5 re-adds. */
function dropConstraints(context: PlanContext): void {
  for (const table of survivingTables(context)) {
    const previous = context.fromTables.get(table.name);
    if (previous === undefined) continue;
    const nextUnique = new Map((table.uniqueConstraints ?? []).map((entry) => [entry.name, entry]));
    for (const unique of sortedUniqueConstraints(previous.uniqueConstraints)) {
      const next = nextUnique.get(unique.name);
      if (next !== undefined && sameStringArray(next.columns, unique.columns)) continue;
      addDraft(context, {
        slug: slug("drop-unique", table.name, unique.name),
        sql: dropConstraintSql(table.name, unique.name),
        risk: "careful",
      });
    }
    const nextColumns = columnsByName(table);
    for (const column of previous.columns) {
      if (!column.isUnique) continue;
      const next = nextColumns.get(column.name);
      if (next !== undefined && next.isUnique) continue;
      addDraft(context, {
        slug: slug("drop-unique", table.name, column.name),
        sql: dropConstraintSql(table.name, uniqueName(table.name, [column.name])),
        risk: "careful",
      });
    }
    const nextChecks = new Map((table.checks ?? []).map((entry) => [entry.name, entry]));
    for (const check of sortedChecks(previous.checks)) {
      const next = nextChecks.get(check.name);
      // Unchanged: nothing to do. Otherwise drop it here; a redefined check is re-added in
      // phase 5 under the same name, so it is a replacement, never a guess.
      if (next !== undefined && next.expression === check.expression) continue;
      addDraft(context, {
        slug: slug("drop-check", table.name, check.name),
        sql: dropConstraintSql(table.name, check.name),
        risk: "careful",
      });
    }
  }
}

/**
 * A removed index is a problem, unless the index only existed to back a column that is
 * being dropped: then dropping it first is required before DROP COLUMN (phase 9).
 */
function dropIndexes(context: PlanContext): void {
  for (const table of survivingTables(context)) {
    const previous = context.fromTables.get(table.name);
    if (previous === undefined) continue;
    const next = new Map((table.indexes ?? []).map((entry) => [entry.name, entry]));
    for (const index of sortedIndexes(previous.indexes)) {
      const current = next.get(index.name);
      // A removed or redefined index is dropped here and, when redefined, recreated in
      // phase 7: same name, so it is a replacement, never a guess.
      if (current !== undefined && sameIndex(index, current)) continue;
      addDraft(context, {
        slug: slug("drop-index", index.name),
        sql: dropIndexSql(index.name),
        risk: "careful",
      });
    }
    const nextUnsupported = new Set((table.unsupported ?? []).map((entry) => `${entry.construct}:${entry.name}`));
    for (const unsupported of previous.unsupported ?? []) {
      // Still declared and unchanged: it needs no DDL, so it must not block the release.
      if (nextUnsupported.has(`${unsupported.construct}:${unsupported.name}`)) continue;
      if (unsupported.construct === "index") {
        addDraft(context, {
          slug: slug("drop-index", unsupported.name),
          sql: dropIndexSql(unsupported.name),
          risk: "careful",
        });
        continue;
      }
      addProblem(context, "unsupported_change", {
        table: table.name,
        construct: `${unsupported.construct}:${unsupported.name}`,
      });
    }
  }
}

/** Phase 1 cleanup for a table dropped in phase 9: every dependent object in the from snapshot. */
function dropRemovedTableDependencies(context: PlanContext): void {
  for (const table of removedTables(context)) {
    for (const policy of sortedPolicies(table.policies)) {
      addDraft(context, {
        slug: slug("drop-policy", table.name, policy.name),
        sql: dropPolicySql(table.name, policy.name),
        risk: "careful",
      });
    }
    for (const unique of sortedUniqueConstraints(table.uniqueConstraints)) {
      addDraft(context, {
        slug: slug("drop-unique", table.name, unique.name),
        sql: dropConstraintSql(table.name, unique.name),
        risk: "careful",
      });
    }
    for (const column of table.columns) {
      if (!column.isUnique) continue;
      addDraft(context, {
        slug: slug("drop-unique", table.name, column.name),
        sql: dropConstraintSql(table.name, uniqueName(table.name, [column.name])),
        risk: "careful",
      });
    }
    for (const check of sortedChecks(table.checks)) {
      addDraft(context, {
        slug: slug("drop-check", table.name, check.name),
        sql: dropConstraintSql(table.name, check.name),
        risk: "careful",
      });
    }
    for (const index of sortedIndexes(table.indexes)) {
      addDraft(context, { slug: slug("drop-index", index.name), sql: dropIndexSql(index.name), risk: "careful" });
    }
    for (const unsupported of table.unsupported ?? []) {
      if (unsupported.construct !== "index") continue;
      addDraft(context, {
        slug: slug("drop-index", unsupported.name),
        sql: dropIndexSql(unsupported.name),
        risk: "careful",
      });
    }
  }
}
