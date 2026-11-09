// .facilis/facilis.app.json: the project's identity for its deployment (APP-UPDATES.md §1).
//
// Written by the template loader at creation and updated only by an upgrade. It lives in
// the generated project's .facilis state directory (gitignored by the template): generated
// metadata, not source the user edits, so an upgrade's rewrite never enters a git diff. A
// managed deployment with admission "facilis-only" refuses to run a project without a
// valid marker (D-063; MANAGED-DEPLOYMENT.md §8). Pure: the VFS read lives in admission.ts.

import type { AdmissionPolicy, DeploymentProfile } from "@/deploy/types";

export const APP_MANIFEST_FILE = ".facilis/facilis.app.json";
export const APP_MANIFEST_SCHEMA_VERSION = 1;
export const FACILIS_TEMPLATE = "facilis";

export interface AppManifest {
  schemaVersion: number;
  template: string;
  templateVersion: string;
  environmentVersion: string;
  createdAt: string;
}

/**
 * The marker a new project carries. The version is the build's environment version, so
 * the update checker (D-065) can compare a project with the build opening it.
 */
export function renderAppManifest(environmentVersion: string, now: Date = new Date()): string {
  const manifest: AppManifest = {
    schemaVersion: APP_MANIFEST_SCHEMA_VERSION,
    template: FACILIS_TEMPLATE,
    templateVersion: environmentVersion,
    environmentVersion,
    createdAt: now.toISOString(),
  };
  return JSON.stringify(manifest, null, 2) + "\n";
}

/** Parse a marker; null when it is not a Facilis app manifest this build understands. */
export function parseAppManifest(text: string): AppManifest | null {
  let raw: Partial<AppManifest> | null;
  try {
    raw = JSON.parse(text) as Partial<AppManifest> | null;
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object") return null;
  if (raw.schemaVersion !== APP_MANIFEST_SCHEMA_VERSION) return null;
  if (raw.template !== FACILIS_TEMPLATE) return null;
  if (typeof raw.environmentVersion !== "string") return null;
  return {
    schemaVersion: raw.schemaVersion,
    template: raw.template,
    templateVersion:
      typeof raw.templateVersion === "string" ? raw.templateVersion : raw.environmentVersion,
    environmentVersion: raw.environmentVersion,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
  };
}

/**
 * Whether this deployment may run the project whose marker is "marker" (null = absent).
 *
 * The open profile never gates (D-051 keeps the editor use case), and "any" is the
 * adopter's explicit opt-out. Only a managed "facilis-only" build reads the marker, and
 * a version mismatch is not a refusal: that is the update checker's business.
 */
export function admitsProject(input: {
  profile: DeploymentProfile;
  admission: AdmissionPolicy;
  marker: string | null;
}): boolean {
  if (input.profile !== "managed") return true;
  if (input.admission === "any") return true;
  return input.marker !== null && parseAppManifest(input.marker) !== null;
}
