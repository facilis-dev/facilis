/**
 * Rule 7 `block-import-valid` (SPEC §9.3): every block the patch imports must match a
 * registered `BlockManifest`. The block supply chain is retired (D-131, no `@facilis.dev/blocks`
 * package ships), so in practice the manifest registers none and the guard rejects every block
 * import; it stays in the rule set as the contract's reserved slot (§7.2/§7.3).
 *
 * The imports are the analyzer's FileFacts, so re-exports and dynamic imports are covered
 * by the same AST truth the rest of validation uses.
 */

import type { EffectiveState } from "../overlay.ts";
import type { ImportFact, PatchContext, ValidationError } from "../types.ts";

const DEFAULT_BLOCKS_PACKAGE = "@facilis.dev/blocks";

/** The import names a block import introduces: named imports and default-import locals. */
function namesOf(imported: ImportFact): string[] {
  if (imported.kind === "named" && imported.imported !== null) return [imported.imported];
  if (imported.kind === "default" && imported.local !== null) return [imported.local];
  return [];
}

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
  // Blocks are no longer configurable: the framework ships one reviewed package (D-067).
  const packages = new Set([DEFAULT_BLOCKS_PACKAGE]);
  const known = new Set(context.blocks.map((block) => block.name));
  const errors: ValidationError[] = [];
  const seen = new Set<string>();
  for (const facts of state.patchedFileFacts) {
    for (const imported of facts.imports) {
      const fromPackageRoot = packages.has(imported.specifier);
      const pathName = blockNameFromPath(imported.specifier, packages);
      const candidates = fromPackageRoot ? namesOf(imported) : pathName === null ? [] : [pathName];
      for (const candidate of candidates) {
        const key = facts.path + "\u0000" + candidate;
        if (known.has(candidate) || seen.has(key)) continue;
        seen.add(key);
        errors.push({
          rule: "block-import-valid",
          severity: "error",
          file: facts.path,
          message: 'Block import "' + candidate + '" does not match a registered BlockManifest.',
          fix_hint:
            "Import an existing block manifest, or stop importing it; do not create new blocks unprompted (SPEC §9.2 rule 5).",
          line: imported.source.line,
        });
      }
    }
  }
  return errors;
}
