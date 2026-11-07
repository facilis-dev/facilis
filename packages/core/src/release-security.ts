// Security diff and release warnings (SPEC §11.3, §7.7): policy add/drop per table,
// same-policy clause changes when both refs carry SQL, RLS disabled on scoped tables,
// and the warnings the preview surfaces for pending migrations and destructive drops.

import type {
  MigrationStatement,
  PolicyChange,
  ReleasePolicySnapshot,
  ReleaseWarning,
  SecurityDiff,
} from "./release.ts";
import type {
  ReleaseMigrationFile,
  ReleasePolicyFact,
  ReleaseTableFact,
} from "./release-preview.ts";
import { splitSqlStatements } from "./release-sql.ts";

export interface DroppedPolicy {
  readonly table: string;
  readonly policy: string;
}

// ── security ───────────────────────────────────────────────────────────────────────

export function diffSecurity(
  beforeTables: readonly ReleaseTableFact[],
  afterTables: readonly ReleaseTableFact[],
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
    if (previous?.sql === undefined || fact.sql === undefined || previous.sql === fact.sql)
      continue;
    policiesChanged.push({
      table: fact.table,
      policy: fact.name,
      before: policySnapshot(previous),
      after: policySnapshot(fact),
      direction: directionOf(previous.sql, fact.sql),
    });
  }
  const rlsDisabled = afterTables
    .filter((table) => table.scoped && !table.rlsEnabled)
    .map((table) => ({ table: table.name }));
  return { policiesAdded, policiesDropped, policiesChanged, rlsDisabled };
}

interface PolicyEntry extends ReleasePolicyFact {
  readonly table: string;
}

function policyMap(tables: readonly ReleaseTableFact[]): Map<string, PolicyEntry> {
  const map = new Map<string, PolicyEntry>();
  for (const table of tables) {
    for (const policy of table.policies)
      map.set(table.name + "\u0000" + policy.name, { ...policy, table: table.name });
  }
  return map;
}

function policySnapshot(entry: PolicyEntry): ReleasePolicySnapshot {
  return { name: entry.name, command: "ALL", using: null, withCheck: null, sql: entry.sql ?? "" };
}

function directionOf(before: string, after: string): PolicyChange["direction"] {
  const scopedBefore = /current_setting\s*\(/i.test(before);
  const scopedAfter = /current_setting\s*\(/i.test(after);
  if (scopedBefore && !scopedAfter) return "broadened";
  if (!scopedBefore && scopedAfter) return "narrowed";
  return "unknown";
}

// ── warnings ───────────────────────────────────────────────────────────────────────

export function collectWarnings(
  statements: readonly MigrationStatement[],
  pendingMigrations: readonly string[],
  droppedPolicies: readonly DroppedPolicy[],
  security: SecurityDiff,
): ReleaseWarning[] {
  const warnings: ReleaseWarning[] = pendingMigrations.map((path) => ({
    kind: "pending_migrations_on_target",
    message: "Migration " + path + " has not been applied to the target database",
    related: path,
  }));
  for (const statement of statements) {
    if (statement.kind !== "drop_table" && statement.kind !== "drop_column") continue;
    warnings.push({
      kind: "destructive_without_backfill",
      message:
        (statement.affectedTable ?? "the schema") +
        " ships a destructive change with no backfill step; verify data retention",
      ...(statement.affectedTable === null ? {} : { related: statement.affectedTable }),
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

export function dropPolicyStatements(
  before: readonly ReleaseMigrationFile[],
  after: readonly ReleaseMigrationFile[],
): DroppedPolicy[] {
  const known = new Set(before.map((file) => file.path));
  const dropped: DroppedPolicy[] = [];
  const recreated = new Set<string>();
  const added: DroppedPolicy[] = [];
  for (const file of after) {
    if (known.has(file.path)) continue;
    for (const sql of splitSqlStatements(file.sql)) {
      const drop =
        /\bdrop\s+policy\s+(?:if\s+exists\s+)?("?[\w$]+"?)\s+on\s+((?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))?)/i.exec(
          sql,
        );
      if (drop !== null) dropped.push(policyTarget(drop[1], drop[2]));
      const create =
        /\bcreate\s+policy\s+("?[\w$]+"?)\s+on\s+((?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))?)/i.exec(
          sql,
        );
      if (create !== null) added.push(policyTarget(create[1], create[2]));
    }
  }
  for (const target of added) recreated.add(target.table + "\u0000" + target.policy);
  return dropped.filter((target) => !recreated.has(target.table + "\u0000" + target.policy));
}

function policyTarget(name: string | undefined, table: string | undefined): DroppedPolicy {
  const clean = (value: string | undefined): string => {
    const text = value ?? "";
    return text.split(".").pop()?.replace(/^"|"$/g, "") ?? "";
  };
  return { table: clean(table), policy: clean(name) };
}
