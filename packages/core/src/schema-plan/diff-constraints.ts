import type { TableSnapshot } from "@facilis.dev/db";

import { addDraft, columnsByName, isScoped, tableList, type PlanContext } from "./diff-helpers.ts";
import { slug } from "./draft.ts";
import { addProblem } from "./problems.ts";
import {
  addCheckSql,
  addColumnUniqueSql,
  addForeignKeySql,
  addUniqueConstraintSql,
  createIndexSql,
  createPolicySql,
  disableRlsSql,
  enableRlsSql,
  foreignKeySignature,
  sameIndex,
  samePolicy,
  sameStringArray,
  sortedChecks,
  sortedForeignKeys,
  sortedIndexes,
  sortedPolicies,
  sortedUniqueConstraints,
} from "./render.ts";

/** Phase 5: unique/check/FK constraints, after every table and column exists. */
export function planConstraints(context: PlanContext): void {
  const tables = tableList(context.toTables);
  for (const table of tables) {
    const previous = context.fromTables.get(table.name);
    planTableUniqueConstraints(context, table, previous);
    planColumnUniqueConstraints(context, table, previous);
  }
  for (const table of tables) planChecks(context, table, context.fromTables.get(table.name));
  for (const table of tables) planForeignKeys(context, table, context.fromTables.get(table.name));
}

function planTableUniqueConstraints(
  context: PlanContext,
  table: TableSnapshot,
  previous: TableSnapshot | undefined,
): void {
  if (previous === undefined) return; // inline in CREATE TABLE
  const before = new Map((previous.uniqueConstraints ?? []).map((entry) => [entry.name, entry]));
  for (const unique of sortedUniqueConstraints(table.uniqueConstraints)) {
    const old = before.get(unique.name);
    if (old !== undefined && sameStringArray(old.columns, unique.columns)) continue;
    addDraft(context, {
      slug: slug("add-unique", table.name, unique.name),
      sql: addUniqueConstraintSql(table.name, unique),
      risk: "careful",
    });
  }
}

function planColumnUniqueConstraints(
  context: PlanContext,
  table: TableSnapshot,
  previous: TableSnapshot | undefined,
): void {
  if (previous === undefined) return; // inline in CREATE TABLE
  const before = columnsByName(previous);
  for (const column of table.columns) {
    if (!column.isUnique) continue;
    if (before.get(column.name)?.isUnique === true) continue;
    addDraft(context, {
      slug: slug("add-unique", table.name, column.name),
      sql: addColumnUniqueSql(table.name, column.name),
      risk: "careful",
    });
  }
}

function planChecks(
  context: PlanContext,
  table: TableSnapshot,
  previous: TableSnapshot | undefined,
): void {
  if (previous === undefined) return; // inline in CREATE TABLE
  const before = new Map((previous.checks ?? []).map((entry) => [entry.name, entry]));
  for (const check of sortedChecks(table.checks)) {
    const old = before.get(check.name);
    if (old !== undefined && old.expression === check.expression) continue;
    addDraft(context, {
      slug: slug("add-check", table.name, check.name),
      sql: addCheckSql(table.name, check),
      risk: "careful",
    });
  }
}

function planForeignKeys(
  context: PlanContext,
  table: TableSnapshot,
  previous: TableSnapshot | undefined,
): void {
  const before = new Set((previous?.foreignKeys ?? []).map(foreignKeySignature));
  for (const foreignKey of sortedForeignKeys(table.foreignKeys)) {
    if (before.has(foreignKeySignature(foreignKey))) continue;
    addDraft(context, {
      slug: slug("add-fk", table.name, foreignKey.columns.join("_")),
      sql: addForeignKeySql(table.name, foreignKey),
      risk: "careful",
    });
  }
}

/** Phase 6: enable RLS before creating policies; disabling RLS on a scoped table is unsafe. */
export function planSecurity(context: PlanContext): void {
  for (const table of tableList(context.toTables)) {
    const previous = context.fromTables.get(table.name);
    planRlsChange(context, table, previous);
    const before = new Map((previous?.policies ?? []).map((policy) => [policy.name, policy]));
    for (const policy of sortedPolicies(table.policies)) {
      const old = before.get(policy.name);
      if (old !== undefined && samePolicy(old, policy)) continue;
      addDraft(context, {
        slug: slug("create-policy", table.name, policy.name),
        sql: createPolicySql(policy),
        risk: "safe",
      });
    }
  }
}

function planRlsChange(context: PlanContext, table: TableSnapshot, previous: TableSnapshot | undefined): void {
  if (previous === undefined) {
    if (table.rlsEnabled) {
      addDraft(context, { slug: slug("enable-rls", table.name), sql: enableRlsSql(table.name), risk: "careful" });
    }
    return;
  }
  if (previous.rlsEnabled === table.rlsEnabled) return;
  if (table.rlsEnabled) {
    addDraft(context, { slug: slug("enable-rls", table.name), sql: enableRlsSql(table.name), risk: "careful" });
    return;
  }
  if (isScoped(previous)) {
    addProblem(context, "policy_unsafe", { table: table.name, construct: "rls" });
    return;
  }
  addDraft(context, { slug: slug("disable-rls", table.name), sql: disableRlsSql(table.name), risk: "careful" });
}

/** Phase 7: plain indexes; a changed definition was dropped in phase 1 and is recreated here. */
export function planIndexes(context: PlanContext): void {
  for (const table of tableList(context.toTables)) {
    const previous = context.fromTables.get(table.name);
    const before = new Map((previous?.indexes ?? []).map((index) => [index.name, index]));
    for (const index of sortedIndexes(table.indexes)) {
      const old = before.get(index.name);
      if (old !== undefined && sameIndex(old, index)) continue;
      addDraft(context, {
        slug: slug("create-index", index.name),
        sql: createIndexSql(table.name, index),
        risk: "careful",
      });
    }
  }
}
