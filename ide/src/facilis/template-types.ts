// Types shared by the template catalogue: the manifest the kernel gets and the example
// sources a descriptor is assembled from.
//
// The run manifest is the kernel contract (D-051 kept it when the 55-template catalog was
// removed); `assets` is the IDE-side addition the create pipeline reads
// (project-assets.ts), never the kernel's.

import type { ProjectManifest } from "../vv/project-manifest";

/** One binary file a template ships beside its sources (see project-assets.ts). */
export type TemplateAsset = { path: string; asset: string };

/** The run manifest plus the assets the IDE inlines into the create request. */
export type FacilisManifest = ProjectManifest & { assets: TemplateAsset[] };

/** The example a template is built from: its files and the package.json they declare. */
export interface ExampleSources {
  /** Project-relative files, keyed by path; the example's package.json is not one of them. */
  files: Record<string, string>;
  /** The example's package.json, the source of the project's generated one. */
  packageJson: string;
}
