// Binary assets of a template (D-032).
//
// A template's `files` are text; a project that installs its own packages from local
// tarballs also needs the tarballs on disk. The kernel's `vv-create-project` writes the
// message's `files` through `writeFilesBatch`, which takes bytes — so the IDE inlines
// them here, same origin and same page, before the create request. The project then
// installs from its `file:` specs without reaching the studio over HTTP.
//
// This used to be a fork-only kernel capability (`manifest.assets`, vendor commit
// `e2f4246`), where the kernel worker fetched the assets itself. The v1.2.0 realignment
// dropped that commit — a downstream embedder passes bytes through the create message's
// `files` instead — so the template manifest keeps the asset list and this module does
// the fetching.

import type { ProjectTemplate } from "../vv/project-manifest";
import type { FacilisManifest, TemplateAsset } from "./facilis-template";
import {
  fetchLocalPackageFiles,
  LOCAL_PACKAGES_ROUTE,
  localPackagesEnabled,
} from "./local-packages";

/** A create-project payload: text files plus binary bodies (structured-cloned to the kernel). */
export type TemplateFilePayload = Record<string, string | Uint8Array>;

/** Vendor-relative asset name to a same-origin URL under the app's configured Vite base. */
function assetUrl(name: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return base + name;
}

/** Fetch one vendor-relative asset, refusing the SPA's 200-with-HTML fallback. */
async function fetchAsset(asset: TemplateAsset, fetchImpl: typeof fetch): Promise<Uint8Array> {
  const response = await fetchImpl(assetUrl(asset.asset));
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || type.includes("text/html")) {
    const served = type ? ` (content-type ${type})` : "";
    throw new Error(
      `facilis: template asset ${asset.asset} is not served here (HTTP ${response.status}${served})`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Merge a template's binary assets into its create-project file map.
 *
 * The asset's `path` is project-relative (the path the `file:` dependency names) and
 * overwrites nothing the template already ships: a collision would be a template bug, and
 * the later asset wins the same way the old kernel-fetched batch did.
 */
export async function withTemplateAssets(
  template: ProjectTemplate,
  files: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<TemplateFilePayload> {
  const assets = (template.manifest as Partial<FacilisManifest>).assets ?? [];
  // The release create request is sources-only: no binary assets and no local packages.
  if (assets.length === 0 && !localPackagesEnabled) return files;
  const fetched = await Promise.all(
    assets.map(async (asset): Promise<readonly [string, Uint8Array]> => [
      asset.path,
      await fetchAsset(asset, fetchImpl),
    ]),
  );
  const payload: TemplateFilePayload = { ...files };
  for (const [path, bytes] of fetched) payload[path] = bytes;
  // Dev local path (issue #41, D-196): copy the workspace packages the template pins with
  // file: specs into the project VFS, through the same create payload (kernel.writeFiles).
  // localPackagesEnabled is false in a production build, so this is compiled out there and
  // the shipped template never carries a vendor/ directory.
  if (localPackagesEnabled) {
    const base = (import.meta.env.BASE_URL || "/") + LOCAL_PACKAGES_ROUTE + "/";
    const local = await fetchLocalPackageFiles(base, fetchImpl);
    for (const [path, bytes] of Object.entries(local)) payload[path] = bytes;
  }
  return payload;
}
