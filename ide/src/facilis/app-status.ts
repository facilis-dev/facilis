// Reading a project's marker from the VFS and planning its update (D-065).
//
// The controller's readFileText is injected so this stays testable without a kernel;
// admission.ts reads the same file through the bridge for the run gate.

import { deployment, environmentVersion } from "@/deploy/current";
import { APP_MANIFEST_FILE, parseAppManifest, type AppManifest } from "./app-manifest";
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
 * a selected recipe asks for are read, so a current project costs a single read.
 */
export async function checkProject(
  read: ReadText,
  root: string,
  currentVersion: string = environmentVersion,
  recipes?: readonly UpdateRecipe[],
): Promise<UpgradePlan> {
  const manifest = await readAppManifest(read, root);
  return planUpgrade({
    root,
    projectVersion: manifest?.environmentVersion ?? null,
    currentVersion,
    recipes,
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
