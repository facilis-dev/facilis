// Applying an upgrade plan, with the invariant that matters (APP-UPDATES.md §4): the
// project is never left half-upgraded.
//
// Order: re-check the plan against the project (a plan is made from a read, and another
// tab or the user may have written since), write the recipe files, run the caller's
// postflight (install, typecheck, DB migration), and only then rewrite .facilis/facilis.app.json.
// Any failure restores every path already touched, in reverse, and leaves the marker
// alone - so a retry starts from the same version.

import { APP_MANIFEST_FILE, renderAppManifest } from "../app-manifest";
import { projectPath, type PlannedFile } from "./plan";

export interface UpgradeIo {
  /** null when the file is absent. */
  read(absolutePath: string): Promise<string | null>;
  write(absolutePath: string, content: string): Promise<void>;
  remove(absolutePath: string): Promise<void>;
}

export interface AppliedUpgrade {
  /** Project-relative paths written or deleted. */
  applied: string[];
  /** Paths the plan listed that were already in their target state. */
  skipped: string[];
}

export class UpgradeError extends Error {
  /** The project-relative path that failed, or "postflight". */
  readonly path: string;
  /** False when restoring the previous files also failed: the project needs attention. */
  readonly rolledBack: boolean;
  readonly reason: unknown;

  constructor(path: string, rolledBack: boolean, reason: unknown) {
    super("upgrade failed at " + path + (rolledBack ? " (rolled back)" : " (rollback incomplete)"));
    this.name = "UpgradeError";
    this.path = path;
    this.rolledBack = rolledBack;
    this.reason = reason;
  }
}

async function verify(
  io: UpgradeIo,
  absolute: (relative: string) => string,
  changes: readonly PlannedFile[],
  markerPath: string,
  marker: string,
): Promise<string | null> {
  for (const change of changes) {
    if ((await io.read(absolute(change.path))) !== change.after) return change.path;
  }
  return (await io.read(markerPath)) === marker ? null : APP_MANIFEST_FILE;
}

/**
 * Apply a planned upgrade. The marker is the commit point: it moves only after every file
 * and the postflight succeeded, and it is the only thing a failed run restores last.
 */
export async function applyUpgrade(input: {
  root: string;
  changes: readonly PlannedFile[];
  /** The version the project lands on; written into the marker only after success. */
  targetVersion: string;
  now?: Date;
  io: UpgradeIo;
  /** Steps that must succeed before the marker moves (install, tsc, DB migration). */
  postflight?: () => Promise<void>;
}): Promise<AppliedUpgrade> {
  const absolute = (relative: string) => projectPath(input.root, relative);
  const markerPath = absolute(APP_MANIFEST_FILE);
  const markerBefore = await input.io.read(markerPath);
  const marker = renderAppManifest(input.targetVersion, input.now);
  const beforeByPath = new Map(input.changes.map((change) => [change.path, change.before]));
  const applied: string[] = [];
  const skipped: string[] = [];
  let failedPath = "";
  let markerWritten = false;

  const rollback = async (): Promise<boolean> => {
    try {
      for (const relative of [...applied].reverse()) {
        const before = beforeByPath.get(relative) ?? null;
        if (before === null) await input.io.remove(absolute(relative));
        else await input.io.write(absolute(relative), before);
      }
      if (markerWritten) {
        if (markerBefore === null) await input.io.remove(markerPath);
        else await input.io.write(markerPath, markerBefore);
      }
      return true;
    } catch {
      return false;
    }
  };

  try {
    for (const change of input.changes) {
      failedPath = change.path;
      const current = await input.io.read(absolute(change.path));
      if (current !== change.before) {
        throw new Error("the project changed since the update was planned");
      }
      if (change.before === change.after) {
        skipped.push(change.path);
        continue;
      }
      if (change.after === null) await input.io.remove(absolute(change.path));
      else await input.io.write(absolute(change.path), change.after);
      applied.push(change.path);
    }
    failedPath = "postflight";
    if (input.postflight !== undefined) await input.postflight();
    failedPath = APP_MANIFEST_FILE;
    await input.io.write(markerPath, marker);
    markerWritten = true;
    const bad = await verify(input.io, absolute, input.changes, markerPath, marker);
    if (bad !== null) {
      failedPath = bad;
      throw new Error("write did not stick: " + bad);
    }
    return { applied, skipped };
  } catch (error) {
    const rolledBack = await rollback();
    throw new UpgradeError(failedPath, rolledBack, error);
  }
}
