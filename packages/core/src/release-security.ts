// Security diff and release warnings (SPEC §11.3, §7.7): policy add/drop per table,
// same-policy clause changes (both refs carry the rendered policy SQL), RLS disabled on
// scoped tables, and the warnings the preview surfaces for destructive batches and
// broadened policies. Policy visibility comes from the declared snapshots, never from
// migration files (D-158, issue #48).

import type { PolicySnapshot, TableSnapshot } from "@facilis.dev/db";

import type {
  PolicyChange,
  ReleasePolicySnapshot,
  ReleaseWarning,
  SecurityDiff,
} from "./release.ts";
import type { SchemaPlan } from "./schema-plan/types.ts";

export interface DroppedPolicy {
  readonly table: string;
  readonly policy: string;
}

// ── security ───────────────────────────────────────────────────────────────────────

export function diffSecurity(
  beforeTables: readonly TableSnapshot[],
  afterTables: readonly TableSnapshot[],
): SecurityDiff {
  const before = policyMap(beforeTables);
  const after = policyMap(afterTables);
  const policiesAdded: ReleasePolicySnapshot[] = [];
  const policiesDropped: ReleasePolicySnapshot[] = [];
  const policiesChanged: PolicyChange[] = [];
  for (const [key, fact] of after) {
    if (!before.has(key)) policiesAdded.push(policySnapshot(fact));
  }
  for (const [key, fact] of before) {
    if (!after.has(key)) policiesDropped.push(policySnapshot(fact));
  }
  for (const [key, fact] of after) {
    const previous = before.get(key);
    if (previous === undefined || previous.sql === fact.sql) continue;
    policiesChanged.push({
      table: fact.table,
      policy: fact.name,
      before: policySnapshot(previous),
      after: policySnapshot(fact),
      direction: directionOf(previous.sql, fact.sql),
    });
  }
  const rlsDisabled = afterTables
    .filter((table) => table.scopeColumn !== undefined && !table.rlsEnabled)
    .map((table) => ({ table: table.name }));
  return { policiesAdded, policiesDropped, policiesChanged, rlsDisabled };
}

interface PolicyEntry extends PolicySnapshot {
  readonly table: string;
}

function policyMap(tables: readonly TableSnapshot[]): Map<string, PolicyEntry> {
  const map = new Map<string, PolicyEntry>();
  for (const table of tables) {
    for (const policy of table.policies)
      map.set(table.name + "\u0000" + policy.name, { ...policy, table: table.name });
  }
  return map;
}

/** The declared policy verbatim: the snapshot carries command, clauses and rendered SQL. */
function policySnapshot(entry: PolicyEntry): ReleasePolicySnapshot {
  return {
    name: entry.name,
    command: entry.command,
    using: entry.using,
    withCheck: entry.withCheck,
    sql: entry.sql,
  };
}

function directionOf(before: string, after: string): PolicyChange["direction"] {
  const scopedBefore = /current_setting\s*\(/i.test(before);
  const scopedAfter = /current_setting\s*\(/i.test(after);
  if (scopedBefore && !scopedAfter) return "broadened";
  if (!scopedBefore && scopedAfter) return "narrowed";
  return "unknown";
}

// ── warnings ───────────────────────────────────────────────────────────────────────

/**
 * Warnings over the generated plan and the declared policy diff. A destructive batch is
 * the artifact's approval list (D-159): v1 ships no data batches, so every destructive
 * batch ships without a backfill step and the preview says so. The preview has no
 * approval flow of its own — approval is a release act bound to the artifact's planHash.
 */
export function collectWarnings(
  plan: SchemaPlan,
  droppedPolicies: readonly DroppedPolicy[],
  security: SecurityDiff,
): ReleaseWarning[] {
  const warnings: ReleaseWarning[] = [];
  for (const id of plan.destructive) {
    warnings.push({
      kind: "destructive_without_backfill",
      message:
        "Batch " + id + " ships a destructive change with no backfill step; verify data retention",
      related: id,
    });
  }
  for (const dropped of droppedPolicies) {
    warnings.push({
      kind: "policy_broadened",
      message:
        "Dropping policy " +
        dropped.policy +
        " on " +
        dropped.table +
        " broadens access unless it is recreated",
      related: dropped.table + "." + dropped.policy,
    });
  }
  for (const change of security.policiesChanged) {
    if (change.direction !== "broadened") continue;
    warnings.push({
      kind: "policy_broadened",
      message:
        "Policy " +
        change.policy +
        " on " +
        change.table +
        " no longer scopes by the policy context",
      related: change.table + "." + change.policy,
    });
  }
  return warnings;
}
