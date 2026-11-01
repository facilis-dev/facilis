// The upgrade recipe contract (APP-UPDATES.md §4): what this build can change in a
// project that outlived it.
//
// A recipe is code shipped with the build - reviewed, tested, available offline - but it
// never touches the VFS: it declares the files the step wants, and the engine reads the
// project's current state (plan.ts) and applies only the diff (apply.ts). Keeping recipes
// declarative is what makes a dry run, a rollback and the "no half-upgraded project"
// invariant possible at all.

import type { MessageKey } from "@/i18n";
import type { RecipeRange } from "../updates";

/** Project-relative read: a recipe only ever sees paths under the project root. */
export type RecipeRead = (relativePath: string) => Promise<string | null>;

/** One file a step wants to have; \`content: null\` deletes it. */
export interface RecipeFile {
  /** Project-relative, forward slashes; assertRecipePath refuses anything else. */
  path: string;
  content: string | null;
}

export interface UpdateRecipe extends RecipeRange {
  /** i18n key of the one-line description shown in the upgrade panel (D-043). */
  titleKey: MessageKey;
  /**
   * The step's files in their final state, computed from the project as it is after the
   * previous step. Idempotent: run it twice and it returns the same answer.
   */
  files: (read: RecipeRead) => Promise<readonly RecipeFile[]> | readonly RecipeFile[];
}

/**
 * Recipe paths are build-time data, never user input. A recipe that could write outside
 * the project would be a silent escape hatch, so the engine refuses at plan time rather
 * than trusting every author to be careful.
 */
export function assertRecipePath(path: string): void {
  const segments = path.split("/");
  const escapes =
    path === "" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..");
  if (escapes) {
    throw new Error("recipe path must stay inside the project: " + JSON.stringify(path));
  }
}
