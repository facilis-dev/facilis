// Reading a project's marker from the VFS and planning its update (D-065).
//
// The controller's readFileText is injected so this stays testable without a kernel;
// admission.ts reads the same file through the bridge for the run gate.

import { deployment, environmentVersion, frameworkPackageMinimums } from "@/deploy/current";
import { APP_MANIFEST_FILE, parseAppManifest, type AppManifest } from "./app-manifest";
import { checkFrameworkPins, parsePackageJson } from "./package-minimums";
import { FRAMEWORK_MINIMUM_TARGET, UPDATE_RECIPES } from "./update-recipes";
import { planUpgrade, type UpgradePlan } from "./upgrade/plan";
import type { UpdateRecipe } from "./upgrade/recipe";

export type ReadText = (absolutePath: string) => Promise<string>;

/** The project's marker, or null when it is absent or unreadable. */
export async function readAppManifest(read: ReadText, root: string): Promise<AppManifest | null> {
  const path = root.replace(/\/+$/, "") + "/" + APP_MANIFEST_FILE;
  try {
    return parseAppManifest(await read(path));
  } catch {
    return null;
  }
}

/**
 * The project's update plan against this build (and, in managed, the approved baseline):
 * the version comparison plus the file plan the shipped recipes produce. Only the files
 * a selected recipe asks for are read, so a current project costs two reads (the marker
 * and package.json — the D-198 pin check needs the latter even for a current marker).
 */
export async function checkProject(
  read: ReadText,
  root: string,
  currentVersion: string = environmentVersion,
  recipes: readonly UpdateRecipe[] = UPDATE_RECIPES,
): Promise<UpgradePlan> {
  const base = root.replace(/\/+$/, "");
  const manifest = await readAppManifest(read, root);
  let packageJson: unknown = null;
  try {
    packageJson = parsePackageJson(await read(base + "/package.json"));
  } catch {
    packageJson = null;
  }
  // D-198: below-minimum pins are a REQUIRED update regardless of the marker version.
  const pins = checkFrameworkPins(packageJson, frameworkPackageMinimums);
  const requiredTargets =
    pins.status === "update-required" && FRAMEWORK_MINIMUM_TARGET !== null
      ? [FRAMEWORK_MINIMUM_TARGET]
      : [];
  return planUpgrade({
    root,
    projectVersion: manifest?.environmentVersion ?? null,
    currentVersion,
    recipes,
    requiredTargets,
    read: async (path) => {
      try {
        return await read(path);
      } catch {
        return null;
      }
    },
  });
}

/** The approved baseline a managed deployment compares against, for the panel. */
export function approvedBaseline(): string {
  return deployment.updates.baseline;
}
