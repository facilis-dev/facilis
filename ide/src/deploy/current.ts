// The deployment profile the app runs with (D-063).
//
// The build compiles it in through Vite's define (see ide/vite.deployment.ts), so the
// value is a literal in the bundle: no fetch, no file, and nothing to override from the
// page. Tests and unbundled imports fall back to the open profile.

import { openDeployment } from "./resolve.ts";
import type { ProjectImports, ResolvedDeployment } from "./types.ts";

declare const __FACILIS_DEPLOYMENT__: ResolvedDeployment | undefined;
declare const __FACILIS_ENV_VERSION__: string | undefined;

export const deployment: ResolvedDeployment =
  typeof __FACILIS_DEPLOYMENT__ !== "undefined" ? __FACILIS_DEPLOYMENT__ : openDeployment();

/** The deployment build's version, written into new projects (APP-UPDATES.md §1). */
export const environmentVersion: string =
  typeof __FACILIS_ENV_VERSION__ !== "undefined" ? __FACILIS_ENV_VERSION__ : "0.0.0";

export const isManaged: boolean = deployment.profile === "managed";

/** Whether a project may enter the IDE through this path (MANAGED-DEPLOYMENT.md §8). */
export function importAllowed(d: ResolvedDeployment, kind: keyof ProjectImports): boolean {
  return d.projects.imports[kind];
}

/** Whether a project may be published back to a git host (D-078). */
export function pushAllowed(d: ResolvedDeployment): boolean {
  return d.projects.exports.git;
}

/** Where the git proxy lives, or null when this build compiled real git out (D-079). */
export function gitProxyConfigured(d: ResolvedDeployment): string | null {
  return d.projects.gitProxy;
}

/** AI is available unless the deployment turned it off. */
export function aiAvailable(d: ResolvedDeployment): boolean {
  return d.ai.mode !== "off";
}

/** In a managed build an empty allowlist means "no skills", not "all skills". */
export function skillAllowed(d: ResolvedDeployment, skillId: string): boolean {
  return d.profile !== "managed" || d.skills.allow.includes(skillId);
}
