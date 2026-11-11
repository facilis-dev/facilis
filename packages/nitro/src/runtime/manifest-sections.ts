import {
  MANIFEST_SECTIONS,
  isManifestSection,
  type FacilisManifest,
  type ManifestSection,
} from "@facilis.dev/core";

export interface SectionsParameter {
  /** True when every requested section name is valid (or none were requested). */
  readonly ok: boolean;
  /** Undefined means "all sections" (the documented default). */
  readonly sections?: readonly ManifestSection[];
  readonly invalid: readonly string[];
}

/** Parse `?sections=config,routes` (SPEC §6.1); invalid names make the request a 400. */
export function parseSectionsParameter(value: string | null): SectionsParameter {
  if (value === null || value.trim() === "") return { ok: true, invalid: [] };

  const requested = value
    .split(",")
    .map((section) => section.trim())
    .filter((section) => section.length > 0);
  const invalid = requested.filter((section) => !isManifestSection(section));
  if (invalid.length > 0) return { ok: false, invalid };

  return { ok: true, sections: [...new Set(requested as ManifestSection[])], invalid: [] };
}

/**
 * Select the manifest sections in the response envelope.
 *
 * `config` maps to `project` and `meta` to `framework`: those are the names the
 * spec uses on the wire (SPEC §6.1) while the manifest type keeps its own layout
 * (SPEC §7.3). Without a filter every section is returned.
 */
export function selectManifestSections(
  manifest: FacilisManifest,
  sections: readonly ManifestSection[] | undefined,
): Partial<FacilisManifest> {
  if (sections === undefined) {
    return {
      framework: manifest.framework,
      project: manifest.project,
      blocks: manifest.blocks,
      routes: manifest.routes,
      schema: manifest.schema,
      i18n: manifest.i18n,
    };
  }

  const selected: Partial<FacilisManifest> = {};
  for (const section of sections) {
    switch (section) {
      case "config":
        selected.project = manifest.project;
        break;
      case "meta":
        selected.framework = manifest.framework;
        break;
      case "blocks":
        selected.blocks = manifest.blocks;
        break;
      case "routes":
        selected.routes = manifest.routes;
        break;
      case "schema":
        selected.schema = manifest.schema;
        break;
      case "i18n":
        selected.i18n = manifest.i18n;
        break;
    }
  }
  return selected;
}

/** All section names, in the canonical order (used when no filter is supplied). */
export const ALL_MANIFEST_SECTIONS: readonly ManifestSection[] = MANIFEST_SECTIONS;
