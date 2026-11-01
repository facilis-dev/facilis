// Turning the recipes this build ships into an explicit file plan (APP-UPDATES.md §4).
//
// The plan is the contract between the build and the VFS: every file appears once with
// the content it has now and the content it must have after, so apply.ts can roll back
// without guessing and the panel can show what would change before anything is written.
// Pure over an injected reader, so the engine is testable without a kernel.

import { compareVersions, planUpdate, type RecipeRange, type UpdateStatus } from "../updates";
import { assertRecipePath, type RecipeFile, type UpdateRecipe } from "./recipe";

/** The content of one project file before and after the upgrade (null = absent). */
export interface PlannedFile {
  path: string;
  before: string | null;
  after: string | null;
}

/** One recipe, with the files it actually changes on this project. */
export interface PlannedStep {
  from: string;
  to: string;
  titleKey: UpdateRecipe["titleKey"];
  files: readonly string[];
}

export interface UpgradePlan {
  status: UpdateStatus;
  projectVersion: string | null;
  currentVersion: string;
  /** The recipes that will run, in order; empty when this build ships none for the jump. */
  steps: PlannedStep[];
  /** The deduped file operations, sorted by path; empty when there is nothing to write. */
  changes: PlannedFile[];
}

/** The planner's read: absolute path, null when the file is absent. */
export type ProjectRead = (absolutePath: string) => Promise<string | null>;

/** Absolute VFS path of a project-relative recipe path. */
export function projectPath(root: string, relative: string): string {
  return root.replace(/\/+$/, "") + "/" + relative;
}

/**
 * A table that cannot be applied in order is a build bug, not a project state: two
 * recipes for the same target version, or a step that does not move forward, make the
 * plan ambiguous. Fail the plan instead of guessing an order.
 */
export function assertRecipeTable(recipes: readonly RecipeRange[]): void {
  const targets = new Set<string>();
  for (const recipe of recipes) {
    if (targets.has(recipe.to)) {
      throw new Error("duplicate update recipe for version " + recipe.to);
    }
    targets.add(recipe.to);
    const order = compareVersions(recipe.from, recipe.to);
    if (order === null || order >= 0) {
      throw new Error("update recipe must move forward: " + recipe.from + " -> " + recipe.to);
    }
  }
}

/**
 * Plan the upgrade of one project against this build. Reads only the files the selected
 * recipes ask for; an up-to-date, unknown or ahead project reads nothing and plans
 * nothing, so the indicator stays free and a downgrade is never offered.
 */
export async function planUpgrade(input: {
  root: string;
  projectVersion: string | null;
  currentVersion: string;
  recipes?: readonly UpdateRecipe[];
  read: ProjectRead;
}): Promise<UpgradePlan> {
  const recipes = input.recipes ?? [];
  assertRecipeTable(recipes);
  const base = planUpdate({
    projectVersion: input.projectVersion,
    currentVersion: input.currentVersion,
    recipes,
  });
  const byTarget = new Map(recipes.map((recipe) => [recipe.to, recipe]));
  // \`original\` is what the project had before any step; \`overlay\` is the state a later
  // step must see. A file touched by two steps keeps its true "before" and the last
  // step's "after" - the plan is about the final state, not the intermediate ones.
  const original = new Map<string, string | null>();
  const overlay = new Map<string, string | null>();

  const readProject = async (relative: string): Promise<string | null> => {
    assertRecipePath(relative);
    if (overlay.has(relative)) return overlay.get(relative) ?? null;
    if (!original.has(relative)) {
      original.set(relative, await input.read(projectPath(input.root, relative)));
    }
    return original.get(relative) ?? null;
  };

  const steps: PlannedStep[] = [];
  for (const versionStep of base.steps) {
    const recipe = byTarget.get(versionStep.to);
    if (recipe === undefined) continue; // planUpdate selected from this table; defensive
    const files: RecipeFile[] = [...(await recipe.files(readProject))];
    const changed: string[] = [];
    for (const file of files) {
      assertRecipePath(file.path);
      const before = await readProject(file.path);
      overlay.set(file.path, file.content);
      if (before !== file.content) changed.push(file.path);
    }
    steps.push({ from: recipe.from, to: recipe.to, titleKey: recipe.titleKey, files: changed });
  }

  const changes: PlannedFile[] = [...overlay.entries()]
    .map(([path, after]) => ({ path, before: original.get(path) ?? null, after }))
    .filter((change) => change.before !== change.after)
    .sort((left, right) => left.path.localeCompare(right.path));

  return {
    status: base.status,
    projectVersion: base.projectVersion,
    currentVersion: base.currentVersion,
    steps,
    changes,
  };
}
