// Curated public API of the @facilis.dev framework packages (chat reference).
//
// The framework is installed from npm, so node_modules (made readable by the dependency
// reader) is the authoritative fallback; this index is the fast path: it is cheap enough to
// keep in the system prompt and precise enough that the model does not have to read
// node_modules for the common cases. Every entry is copied by hand from packages/<pkg>/src,
// and framework-reference.test.ts fails when a name disappears from that source, so the
// index cannot silently drift from the framework.

import { FRAMEWORK_MODULES } from "./framework-reference-data";

export { FRAMEWORK_MODULES };

export type FrameworkEntryKind = "function" | "type" | "constant";

export interface FrameworkEntry {
  /** Exported symbol, exactly as the package spells it (the drift test checks this). */
  name: string;
  kind: FrameworkEntryKind;
  /** Call/assignment shape, abbreviated: parameter names are the real ones, bodies are not. */
  signature: string;
  /** What it is for, in the vocabulary of the project's own code. */
  summary: string;
  /** Only where the shape needs teaching (a route, a table, a job); deliberately short. */
  example?: string;
}

export interface FrameworkModule {
  /** Short id the model passes as `module` to the framework_reference tool. */
  id: string;
  /** npm package name; also accepted by framework_reference because the model may know it. */
  package: string;
  summary: string;
  entries: readonly FrameworkEntry[];
}

export interface FrameworkEntryWithModule extends FrameworkEntry {
  module: string;
  package: string;
}

export interface FrameworkReferenceInput {
  module?: string;
  query?: string;
}

export interface FrameworkReferenceResult {
  matches: readonly FrameworkEntryWithModule[];
  truncated: boolean;
}

/**
 * One entry cap for both the prompt index and the tool: enough to cover every symbol a
 * generated route, schema or job needs after a broad query, small enough that the result
 * never crowds out the project source the model is working on.
 */
export const MAX_REFERENCE_ENTRIES = 40;

function shortPackageName(module: FrameworkModule): string {
  const slash = module.package.indexOf("/");
  return slash === -1 ? module.package : module.package.slice(slash + 1);
}

/** Case-insensitive module match on the id and on either spelling of the package name. */
function matchesModule(module: FrameworkModule, needle: string): boolean {
  return (
    module.id.toLowerCase() === needle ||
    module.package.toLowerCase() === needle ||
    shortPackageName(module).toLowerCase() === needle
  );
}

function matchesQuery(entry: FrameworkEntry, needle: string): boolean {
  return (
    entry.name.toLowerCase().includes(needle) ||
    entry.signature.toLowerCase().includes(needle) ||
    entry.summary.toLowerCase().includes(needle)
  );
}

/**
 * The compact system-prompt block: one line per module with its id, summary and entry
 * names. Full signatures come from the tool, so the prompt pays for discovery only.
 */
export function frameworkIndex(): string {
  const lines = [
    "Framework reference (@facilis.dev packages, installed under node_modules; ask framework_reference({ module, query }) for signatures and examples):",
  ];
  for (const module of FRAMEWORK_MODULES) {
    const names = module.entries.map((entry) => entry.name).join(", ");
    lines.push("- " + module.id + " [" + module.package + "]: " + module.summary + " — " + names);
  }
  return lines.join("\n");
}

/**
 * Look up entries by module and/or a case-insensitive substring of name/signature/summary.
 * Scanning stops at MAX_REFERENCE_ENTRIES and reports `truncated`, so a broad query is
 * bounded data rather than an unbounded tool result.
 */
export function referenceFor(input: FrameworkReferenceInput): FrameworkReferenceResult {
  const moduleNeedle = input.module?.trim().toLowerCase();
  const queryNeedle = input.query?.trim().toLowerCase();
  const matches: FrameworkEntryWithModule[] = [];
  for (const module of FRAMEWORK_MODULES) {
    if (
      moduleNeedle !== undefined &&
      moduleNeedle.length > 0 &&
      !matchesModule(module, moduleNeedle)
    ) {
      continue;
    }
    for (const entry of module.entries) {
      if (
        queryNeedle !== undefined &&
        queryNeedle.length > 0 &&
        !matchesQuery(entry, queryNeedle)
      ) {
        continue;
      }
      if (matches.length >= MAX_REFERENCE_ENTRIES) return { matches, truncated: true };
      matches.push({ ...entry, module: module.id, package: module.package });
    }
  }
  return { matches, truncated: false };
}

/** The seam the PTC tool host receives; absent when the chat runs without the chat host. */
export interface FrameworkAccess {
  reference(input: FrameworkReferenceInput): FrameworkReferenceResult;
}

export function createFrameworkAccess(): FrameworkAccess {
  return { reference: referenceFor };
}
