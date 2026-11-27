/**
 * Direct `process.env` reads in project code (D-224).
 *
 * The runtime section is the declared surface: a server module reads it through `ctx.runtime` or
 * `runtimeEnv()`, and a client module through `publicConfig()`. A direct read bypasses the
 * declaration check and, in the browser, silently yields nothing. Warn-only on purpose — a project
 * may still need a value for a dependency — but the hint is specific enough to act on.
 */
import { identifierName, memberName, type AstNode } from "../ast/node.ts";
import { walk } from "../ast/walk.ts";
import { warning } from "../diagnostics.ts";
import type { ModuleGraph } from "../module-graph.ts";
import { sourceRef } from "../source.ts";
import type { Diagnostic } from "../types.ts";

export const NO_DIRECT_ENV = "no-direct-env";

/** Vite's config runs before the bundle exists; it is the one legitimate non-runtime reader. */
const EXEMPT_FILES = new Set(["facilis.config.ts", "vite.config.ts"]);

export function noDirectEnvDiagnostics(graph: ModuleGraph): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const file of graph.files.values()) {
    if (file.path.startsWith("node_modules/") || EXEMPT_FILES.has(file.path)) continue;
    if (!file.path.startsWith("src/") && !file.path.startsWith("server/")) continue;
    const client = file.path.startsWith("src/");
    walk(file.program, (node) => {
      if (!isProcessEnv(node)) return;
      diagnostics.push(
        warning(
          NO_DIRECT_ENV,
          client
            ? "process.env is read in client code: a browser has no environment; declare the value in public and read publicConfig() (D-224)"
            : "process.env is read in server code: declare the key in the runtime section and read ctx.runtime or runtimeEnv() (D-224)",
          sourceRef(file.path, file.lines, node.start ?? 0),
        ),
      );
    });
  }
  return diagnostics;
}

/** `process.env` exactly: the outer `.KEY` member is a different node and matches too, once. */
function isProcessEnv(node: AstNode): boolean {
  return (
    node.type === "MemberExpression" &&
    memberName(node) === "env" &&
    identifierName(node["object"]) === "process"
  );
}
