// The confirmed half of a paused write (D-193/D-226): the user answered the card, so the write
// the turn paused on is validated again against the project as it is NOW (the card may have
// been open while other writes landed), then applied. A destructive write is also recorded as
// the dev database's consent for exactly those drops; a surface confirmation passes
// confirmedSurface so the revalidation does not ask about the declarations again.

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
  /** Rule 15's wording: what the user confirmed. Absent for a surface confirmation. */
  changes?: readonly string[];
  /**
   * The user confirmed the patch's declared capabilities (D-226): the second validation must
   * not ask again, or the write would never land.
   */
  confirmedSurface?: boolean;
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
    ...(pending.confirmedSurface === true ? { confirmedSurface: true } : {}),
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
  // A destructive write is confirmed by its own card; a declaration in the SAME patch is not
  // (D-226). Writing it would bypass the surface confirmation, so refuse and ask for a split:
  // the declaration's own write then pauses on the surface card.
  if (pending.confirmedSurface !== true && (checked.validation.surfaceRequests ?? []).length > 0) {
    return findingsOutcome(pending.patch.path, [
      finding(
        "surface-confirmation",
        pending.patch.path,
        "This write also declares a non-standard capability the user has not confirmed.",
        "Split the change: apply the schema change in its own write, then add the declaration.",
      ),
    ]);
  }
  const outcome = await persistWrite(
    deps.persist,
    pending.patch,
    checked.validation,
    checked.context,
    root,
    undefined,
  );
  if (outcome.ok && pending.changes !== undefined) {
    await recordSchemaApprovals(deps.host, pending.changes);
  }
  return outcome;
}
