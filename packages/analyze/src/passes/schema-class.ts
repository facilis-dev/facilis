/**
 * Table access class (invariant 4, D-136/D-211): every PROJECT table is RLS-scoped
 * (`.enableRLS()` plus a policy set) or explicitly system-only. A plain `pgTable` without
 * RLS silently gets no app-role privilege — `ensureAppRole` grants by the catalog alone — so
 * its routes fail closed at runtime; the class must be declared, not inferred.
 *
 * The explicit system-only marker is a comment, `// system-only` (optionally `: reason`),
 * on the line immediately above the table declaration. A comment adds no runtime surface:
 * the grant boundary stays the catalog (D-136), and the marker only tells the static pass
 * the omission of RLS is deliberate. Framework tables are exempt: they ship their own class
 * and reach the schema by re-export, never as a project declaration.
 */
import { diagnostic } from "../diagnostics.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import type { Diagnostic, SourceRef, TableFact, UnknownFact } from "../types.ts";
import { isSchemaFile } from "./schema-dsl.ts";

/** `system-only`, `system-only: reason` or `system-only reason`; nothing longer. */
const SYSTEM_ONLY_MARKER = /^system-only(?::|\s|$)/;

export type TableClass = "rls-scoped" | "system-only" | "rls-no-policies" | "undeclared";

function classOf(rlsEnabled: boolean, policyCount: number, systemOnly: boolean): TableClass {
  if (rlsEnabled) return policyCount > 0 ? "rls-scoped" : "rls-no-policies";
  return systemOnly ? "system-only" : "undeclared";
}

/** The class a table fact declares; shared with AI validator rule 20 so both read one contract. */
export function tableClassOf(table: TableFact): TableClass {
  return classOf(table.rlsEnabled, table.policies.length, table.systemOnly);
}

/** True when a marker comment sits on the line immediately above the declaration start. */
export function hasSystemOnlyMarker(
  file: ProjectFile,
  declarationStart: number | undefined,
): boolean {
  if (file.comments === null) return false;
  const line = file.lines.lineAt(typeof declarationStart === "number" ? declarationStart : 0);
  for (const comment of file.comments) {
    if (file.lines.lineAt(comment.end) !== line - 1) continue;
    if (SYSTEM_ONLY_MARKER.test(comment.value.trim())) return true;
  }
  return false;
}

export interface TableClassInput {
  readonly graph: ModuleGraph;
  readonly file: ProjectFile;
  readonly declarationStart: number | undefined;
  readonly name: string;
  readonly rlsEnabled: boolean;
  readonly policyCount: number;
  readonly source: SourceRef;
}

export interface TableClassScan {
  readonly systemOnly: boolean;
  readonly unknowns: readonly UnknownFact[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Read the class of one table declaration. Only project schema files are checked: a framework
 * file reached by re-export carries its own class (D-136). When the parser exposes no comments
 * the marker is unreadable, so a missing class is a warning, never a guessed error (D-211).
 */
export function readTableClass(input: TableClassInput): TableClassScan {
  const { graph, file, declarationStart, name, rlsEnabled, policyCount, source } = input;
  if (!isSchemaFile(graph, file.path)) {
    return { systemOnly: false, unknowns: [], diagnostics: [] };
  }
  const markerReadable = file.comments !== null;
  const systemOnly = markerReadable && hasSystemOnlyMarker(file, declarationStart);
  const unknowns: UnknownFact[] = [];
  const diagnostics: Diagnostic[] = [];
  // RLS-on tables carry their class regardless of the marker; only a no-RLS table depends on it.
  if (!markerReadable && !rlsEnabled) {
    unknowns.push({
      code: "schema-marker",
      reason:
        'system-only marker of table "' + name + '" is not readable (parser supplied no comments)',
      source,
    });
  }
  const declared = classOf(rlsEnabled, policyCount, systemOnly);
  if (declared === "rls-no-policies") {
    diagnostics.push(
      diagnostic(
        "table-rls-no-policies",
        "warning",
        'table "' +
          name +
          '" enables RLS but declares no policy: the app role reaches no row (D-136)',
        source,
      ),
    );
  } else if (declared === "undeclared") {
    diagnostics.push(
      diagnostic(
        "table-class-declared",
        markerReadable ? "error" : "warning",
        markerReadable
          ? 'table "' +
              name +
              '" declares no access class: add .enableRLS() with a policy, or a "// system-only" marker (D-136/D-211)'
          : 'table "' +
              name +
              '" has no RLS and its system-only marker cannot be read; the access class is not provable (D-136/D-211)',
        source,
      ),
    );
  }
  return { systemOnly, unknowns, diagnostics };
}
