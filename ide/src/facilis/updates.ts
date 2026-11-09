// Project-vs-build version comparison for the update indicator (D-065, APP-UPDATES.md).
//
// Pure: no VFS, no React. The build's version is compiled in (environmentVersion); the
// project's version comes from .facilis/facilis.app.json. The check therefore needs no network,
// which is what makes it work air-gapped.

export type UpdateStatus = "unknown" | "current" | "outdated" | "ahead";

/** A calver-ish version: the numeric components, missing ones treated as zero. */
export function parseVersion(raw: string | null | undefined): number[] | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.trim();
  // The numeric core only: a pre-release suffix ("2026.11.1-beta") is not ordered by
  // this comparison, and the safe answer for a version it cannot order is "unknown",
  // never a guessed "outdated".
  const numeric = /^[0-9.]+/.exec(text)?.[0] ?? "";
  const parts = numeric
    .split(".")
    .filter((part) => part !== "")
    .map((part) => Number.parseInt(part, 10));
  if (parts.length === 0 || parts.some((part) => Number.isNaN(part))) return null;
  return parts;
}

/** Negative when "a" is older, zero when equal, positive when newer; null if unparseable. */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === null || right === null) return null;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * Where a project stands relative to the build opening it. A missing marker or an
 * unparseable version is "unknown", never "current": the indicator must not claim an
 * unknown project is up to date.
 */
export function updateStatus(
  projectVersion: string | null | undefined,
  currentVersion: string,
): UpdateStatus {
  if (projectVersion === null || projectVersion === undefined) return "unknown";
  const comparison = compareVersions(projectVersion, currentVersion);
  if (comparison === null) return "unknown";
  if (comparison === 0) return "current";
  return comparison < 0 ? "outdated" : "ahead";
}

/** The minimum the planner reads from a recipe: a version range (APP-UPDATES.md §4). */
export interface RecipeRange {
  /** Version the recipe upgrades from (exclusive lower bound). */
  from: string;
  /** Version the recipe lands on; also its id. */
  to: string;
}

export interface UpdateStep {
  from: string;
  to: string;
}

export interface UpdatePlan {
  status: UpdateStatus;
  projectVersion: string | null;
  currentVersion: string;
  /** The ordered recipe steps this build can apply; empty when it ships none. */
  steps: UpdateStep[];
}

/**
 * Plan the upgrade between a project and this build. Only recipes whose target is
 * above the project and at or below the build are eligible, so a build never claims
 * a jump it cannot make.
 */
export function planUpdate(input: {
  projectVersion: string | null;
  currentVersion: string;
  recipes?: readonly RecipeRange[];
}): UpdatePlan {
  const { projectVersion, currentVersion } = input;
  const status = updateStatus(projectVersion, currentVersion);
  const recipes = input.recipes ?? [];
  const steps: UpdateStep[] = [];
  if (projectVersion !== null && (status === "outdated" || status === "current")) {
    for (const recipe of recipes) {
      const from = compareVersions(projectVersion, recipe.to);
      const to = compareVersions(currentVersion, recipe.to);
      if (from !== null && to !== null && from < 0 && to >= 0) {
        steps.push({ from: recipe.from, to: recipe.to });
      }
    }
    steps.sort((a, b) => compareVersions(a.to, b.to) ?? 0);
  }
  return { status, projectVersion, currentVersion, steps };
}
