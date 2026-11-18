// The IDE half of the destructive-schema consent (D-193): when the user confirms a write
// that drops a table or a column, the confirmation is recorded in the project's dev state so
// the next boot applies exactly that DDL and nothing else. The runtime never runs an
// unconfirmed drop, so this file is the only way a destructive change reaches a dev database.

import {
  parseSchemaApprovals,
  SCHEMA_APPROVALS_PATH,
  schemaApprovalsJson,
} from "@facilis.dev/core/dev-approvals";

import type { PatchBridge } from "@/facilis/apply-patch";

export interface SchemaApprovalHost {
  root(): string | null;
  bridge: PatchBridge;
  /** Project-relative read; throws when the file is missing. */
  read(path: string): Promise<string>;
}

/** Append the confirmed changes to `.facilis/dev/schema-approvals.json` (best effort). */
export async function recordSchemaApprovals(
  host: SchemaApprovalHost,
  changes: readonly string[],
): Promise<void> {
  const root = host.root();
  if (root === null || changes.length === 0) return;
  let existing: string[] = [];
  try {
    existing = parseSchemaApprovals(await host.read(SCHEMA_APPROVALS_PATH));
  } catch {
    // No approvals file yet: the first confirmation creates it.
  }
  try {
    await host.bridge.request("vv-write", {
      path: root + "/" + SCHEMA_APPROVALS_PATH,
      contents: schemaApprovalsJson([...existing, ...changes]),
    });
  } catch {
    // Without the marker the dev boot refuses the drop and reports the drift; never fail
    // the user's confirmed write because the consent file could not be written.
  }
}
