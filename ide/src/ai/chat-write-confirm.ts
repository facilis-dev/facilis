// The confirmed half of a destructive schema write (D-193): the user answered the card, so
// the write the turn paused on is validated again against the project as it is NOW (the card
// may have been open while other writes landed), applied, and recorded as the dev database's
// consent for exactly those drops.

import type { FilePatch } from "@facilis.dev/ai";

import {
  finding,
  findingsOutcome,
  type ChatWritesHost,
  type WriteOutcome,
} from "./chat-write-types";
import { persistWrite, type PersistDeps } from "./chat-write-persist";
import { validatePatchesWithHost } from "./patch-validation";
import { recordSchemaApprovals } from "./schema-approval";

export interface PendingWrite {
  patch: FilePatch;
  /** Rule 15's wording: what the user confirmed. */
  changes: readonly string[];
}

export interface ApplyConfirmedDeps {
  host: ChatWritesHost;
  /** The overlay as the turn left it when the card opened. */
  overlay(): readonly FilePatch[];
  persist: PersistDeps;
  /** The validator could not run: the turn ends as an outage, not a repair round. */
  markOutage(): void;
}

export async function applyConfirmedWrite(
  deps: ApplyConfirmedDeps,
  pending: PendingWrite,
): Promise<WriteOutcome> {
  const root = deps.host.root();
  if (root === null) {
    return findingsOutcome(pending.patch.path, [
      finding(
        "project-root",
        pending.patch.path,
        "No project folder is open.",
        "Open a project, then retry.",
      ),
    ]);
  }
  const checked = await validatePatchesWithHost([pending.patch], deps.host, {
    requiresConfirmation: true,
    overlay: deps.overlay(),
  });
  if (checked.context === null) {
    deps.markOutage();
    return findingsOutcome(
      pending.patch.path,
      checked.validation.errors,
      checked.validation.warnings,
    );
  }
  if (!checked.validation.ok) {
    return findingsOutcome(
      pending.patch.path,
      checked.validation.errors,
      checked.validation.warnings,
    );
  }
  const outcome = await persistWrite(
    deps.persist,
    pending.patch,
    checked.validation,
    checked.context,
    root,
    undefined,
  );
  if (outcome.ok) await recordSchemaApprovals(deps.host, pending.changes);
  return outcome;
}
