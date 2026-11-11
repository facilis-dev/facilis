/**
 * `server/jobs/**` definitions -> JobFacts (D-157 applied to jobs).
 *
 * One default export per file: a `defineJob()` call from `@facilis.dev/core`. A file that is not
 * a valid definition is a warning, not an error: jobs are optional, so a broken file must not
 * hide the rest of the project. `dbTables` is the declaration the runtime guard enforces, so
 * an unreadable one is explicit (null) and its warning keeps the jobs gate red.
 */

import { callArguments, identifierName, unwrapExpression, type AstNode } from "../ast/node.ts";
import { warning } from "../diagnostics.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import type { StaticContext } from "../static-eval.ts";
import type { Diagnostic, UnknownFact } from "../types.ts";
import type { JobFact } from "../types-jobs.ts";
import {
  defaultExportExpression,
  isLocallyDeclared,
  readStaticObject,
  refOf,
  relativePath,
  sortDiagnostics,
} from "./static-read.ts";

const CORE_SPECIFIER = "@facilis.dev/core";
const JOBS_DIR = "server/jobs/";
const STATIC_CODE = "job-definition-static";

export interface JobResult {
  readonly jobs: readonly JobFact[];
  readonly diagnostics: readonly Diagnostic[];
}

interface DefinitionResolution {
  readonly call: AstNode | null;
  readonly reason: string;
}

/** The default export must be a `defineJob(...)` call of the core import. */
function resolveDefinition(file: ProjectFile): DefinitionResolution {
  const expression = defaultExportExpression(file);
  if (expression === undefined) {
    return { call: null, reason: "the job file has no default export" };
  }
  if (expression.type !== "CallExpression") {
    return { call: null, reason: "the default export is not a defineJob() call" };
  }
  const callee = unwrapExpression(expression.callee);
  const name = callee?.type === "Identifier" ? identifierName(callee) : undefined;
  if (name === undefined) return { call: null, reason: "the defineJob callee cannot be resolved" };
  if (isLocallyDeclared(file, name)) {
    return { call: null, reason: '"' + name + '" is shadowed by a local declaration' };
  }
  const imported = file.module.imports.find((entry) => entry.local === name);
  if (
    imported === undefined ||
    imported.specifier !== CORE_SPECIFIER ||
    imported.imported !== "defineJob"
  ) {
    return {
      call: null,
      reason: "the default export is not the defineJob import from @facilis.dev/core",
    };
  }
  return { call: expression, reason: "" };
}

/** The `defineJob(...)` call of a valid definition, for later passes (D-157). */
export function resolveJobCall(file: ProjectFile): AstNode | null {
  return resolveDefinition(file).call;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((entry): entry is string => typeof entry === "string") ? [...value] : null;
}

function scanFile(
  graph: ModuleGraph,
  file: ProjectFile,
): {
  readonly job: JobFact | null;
  readonly diagnostics: readonly Diagnostic[];
} {
  const context: StaticContext = { graph, file: file.path };
  const definition = resolveDefinition(file);
  const ref = refOf(context, definition.call ?? defaultExportExpression(file));
  if (definition.call === null) {
    return { job: null, diagnostics: [warning("job-definition", definition.reason, ref)] };
  }
  const object = readStaticObject(callArguments(definition.call)[0], context, {
    code: STATIC_CODE,
    report: false,
  });
  // A structural read failure (spread/computed key) makes the whole definition suspect: keep
  // it visible as an unknown and as a warning, as the route config reader does.
  const unknown: UnknownFact[] = [...object.unknown];
  const diagnostics: Diagnostic[] = object.unknown.map((item) =>
    warning(item.code, item.reason, item.source),
  );
  const note = (reason: string, at: AstNode | undefined): void => {
    const source = refOf(context, at);
    unknown.push({ code: STATIC_CODE, reason, source });
    diagnostics.push(warning(STATIC_CODE, reason, source));
  };

  const nameField = object.fields.get("name");
  let name: string | null = null;
  if (
    nameField !== undefined &&
    nameField.ok &&
    typeof nameField.value === "string" &&
    nameField.value.length > 0
  ) {
    name = nameField.value;
  }
  if (name === null) {
    diagnostics.push(
      warning(
        "job-definition",
        "the job name cannot be read statically",
        refOf(context, nameField?.node),
      ),
    );
    return { job: null, diagnostics };
  }

  const tablesField = object.fields.get("dbTables");
  let dbTables: string[] | null = null;
  if (tablesField === undefined) {
    note("dbTables is missing; declare the relations the job touches ([] means none)", undefined);
  } else if (!tablesField.ok) {
    note(
      "dbTables cannot be read statically: " + (tablesField.reason ?? "unsupported"),
      tablesField.node,
    );
  } else {
    dbTables = stringArray(tablesField.value);
    if (dbTables === null) note("dbTables must be a string[]", tablesField.node);
  }

  const rawSqlField = object.fields.get("rawSql");
  let rawSql: boolean | null = false;
  if (rawSqlField !== undefined && !rawSqlField.ok) {
    rawSql = null;
    note(
      "rawSql cannot be read statically: " + (rawSqlField.reason ?? "unsupported"),
      rawSqlField.node,
    );
  } else if (rawSqlField !== undefined) {
    if (typeof rawSqlField.value === "boolean") rawSql = rawSqlField.value;
    else {
      // An unreadable derogation is never assumed: db.execute then fails closed (D-157).
      rawSql = null;
      note("rawSql must be a boolean", rawSqlField.node);
    }
  }

  return {
    job: { name, sourceFile: file.path, source: ref, dbTables, rawSql, unknown },
    diagnostics,
  };
}

/** Read every job module under `server/jobs/` into facts (test files are skipped). */
export function buildJobFacts(graph: ModuleGraph): JobResult {
  const files = [...graph.files.values()]
    .filter((file) => {
      const relative = relativePath(graph.root, file.path);
      return relative.startsWith(JOBS_DIR) && !relative.endsWith(".test.ts");
    })
    .toSorted((left, right) => left.path.localeCompare(right.path));
  const jobs: JobFact[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const file of files) {
    const scanned = scanFile(graph, file);
    if (scanned.job !== null) jobs.push(scanned.job);
    diagnostics.push(...scanned.diagnostics);
  }
  return { jobs, diagnostics: sortDiagnostics(diagnostics) };
}
