/**
 * Rule 7 `block-import-valid` (SPEC §9.3): every block the patch imports must match a
 * registered `BlockManifest`. Blocks are a reviewed supply chain (D-067), so an import
 * names a block the project already has; a brand-new block component is rule 5's
 * "do not create new blocks unprompted".
 */

import type { EffectiveState } from "../overlay.ts";
import { collectImports } from "../scan.ts";
import type { PatchContext, ValidationError } from "../types.ts";

const DEFAULT_BLOCKS_PACKAGE = "@facilis/blocks";

/** The block name an import points at, or null when the specifier is not a block import. */
function blockNameFromPath(specifier: string, packages: ReadonlySet<string>): string | null {
  for (const pkg of packages) {
    if (specifier === pkg) return null;
    if (specifier.startsWith(pkg + "/")) {
      const name = specifier.slice(pkg.length + 1).split("/")[0];
      return name === undefined || name.length === 0 ? null : name;
    }
  }
  const segments = specifier.split("/");
  const index = segments.indexOf("blocks");
  if (index === -1) return null;
  const name = segments[index + 1];
  return name === undefined || name.length === 0 ? null : name;
}

export function blockImportErrors(state: EffectiveState, context: PatchContext): ValidationError[] {
  const packages = new Set(state.config.blocksPackages);
  packages.add(DEFAULT_BLOCKS_PACKAGE);
  const known = new Set(context.blocks.map((block) => block.name));
  const errors: ValidationError[] = [];
  const seen = new Set<string>();
  for (const source of state.patchedSources) {
    for (const reference of collectImports(source.content)) {
      const fromPackageRoot = [...packages].some((pkg) => reference.specifier === pkg);
      const pathName = blockNameFromPath(reference.specifier, packages);
      const candidates = fromPackageRoot ? reference.names : pathName === null ? [] : [pathName];
      for (const candidate of candidates) {
        const key = source.path + "\u0000" + candidate;
        if (known.has(candidate) || seen.has(key)) continue;
        seen.add(key);
        errors.push({
          rule: "block-import-valid",
          severity: "error",
          file: source.path,
          message: 'Block import "' + candidate + '" does not match a registered BlockManifest.',
          fix_hint:
            "Import an existing block manifest, or stop importing it; do not create new blocks unprompted (SPEC §9.2 rule 5).",
        });
      }
    }
  }
  return errors;
}
