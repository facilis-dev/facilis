/**
 * Read sites for the declared `runtime` / `public` surfaces (D-224).
 *
 * Three accessors exist: `ctx.runtime` and `runtimeEnv()` are server-only, `publicConfig()`
 * is the client accessor. The pass also finds the `import.meta.env.VITE_*` bypass Vite keeps
 * alive for third-party libraries. Every hit carries its source; a computed key is skipped,
 * because a key the analyzer cannot name is unknown, never a guess.
 */

import { KNOWN_RUNTIME_KEYS } from "@facilis.dev/core";

import {
  identifierName,
  memberName,
  nodeArray,
  propertyName,
  unwrapExpression,
  type AstNode,
} from "../ast/node.ts";
import { walk } from "../ast/walk.ts";
import { error, warning } from "../diagnostics.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import { sourceRef } from "../source.ts";
import type { ConfigFacts, Diagnostic, SourceRef } from "../types.ts";
import type { RuntimeKeyFact } from "../types-runtime.ts";
import { requirementDiagnostics } from "./runtime-requirements.ts";
import { sortDiagnostics } from "./static-read.ts";

export const RUNTIME_KEY_UNDECLARED = "runtime-key-undeclared";
export const RUNTIME_KEY_UNSET = "runtime-key-unset";
export const RUNTIME_KEY_SERVER_ONLY = "runtime-key-server-only";
export const RUNTIME_KEY_UNUSED = "runtime-key-unused";
export const VITE_ENV_DIRECT = "vite-env-direct";

type ReadSurface = "runtime" | "public";

export interface RuntimeRead {
  readonly key: string;
  readonly surface: ReadSurface;
  /** The accessor spelling, for the diagnostic message. */
  readonly accessor: string;
  readonly source: SourceRef;
  /** Files under `src/` ship to the browser; a runtime read there is a leak of the surface. */
  readonly clientReachable: boolean;
}

export interface ViteEnvRead {
  readonly name: string;
  readonly source: SourceRef;
}

export interface RuntimeAccessResult {
  readonly reads: readonly RuntimeRead[];
  readonly viteEnv: readonly ViteEnvRead[];
}

export function readRuntimeAccess(graph: ModuleGraph): RuntimeAccessResult {
  const reads: RuntimeRead[] = [];
  const viteEnv: ViteEnvRead[] = [];
  for (const file of graph.files.values()) {
    if (isFrameworkPath(file.path)) continue;
    collectFile(file, reads, viteEnv);
  }
  return { reads, viteEnv };
}

function isFrameworkPath(path: string): boolean {
  return path.startsWith("node_modules/");
}

function isClientReachable(path: string): boolean {
  return path.startsWith("src/");
}

function inViteEnvScope(path: string): boolean {
  // Vite's own config may read import.meta.env (it runs before the project bundle exists).
  return (path === "src" || path.startsWith("src/") || path.startsWith("server/")) &&
    path !== "vite.config.ts";
}

function collectFile(
  file: ProjectFile,
  reads: RuntimeRead[],
  viteEnv: ViteEnvRead[],
): void {
  const at = (node: AstNode): SourceRef => sourceRef(file.path, file.lines, node.start ?? 0);
  const push = (key: string, surface: ReadSurface, accessor: string, node: AstNode): void => {
    reads.push({
      key,
      surface,
      accessor,
      source: at(node),
      clientReachable: isClientReachable(file.path),
    });
  };

  walk(file.program, (node) => {
    if (node.type === "MemberExpression") {
      const key = memberName(node);
      if (key === undefined) return;
      const object = unwrapExpression(node.object);
      const accessor = object === undefined ? null : accessorOf(object);
      if (accessor !== null) {
        push(key, accessor.surface, accessor.name, node);
        return;
      }
      if (key.startsWith("VITE_") && object !== undefined && isImportMetaEnv(object)) {
        if (inViteEnvScope(file.path)) viteEnv.push({ name: key, source: at(node) });
      }
      return;
    }
    if (node.type !== "VariableDeclarator") return;
    const id = unwrapExpression(node.id);
    const init = unwrapExpression(node.init);
    if (id?.type !== "ObjectPattern" || init === undefined) return;
    const accessor = accessorOf(init);
    if (accessor === null) return;
    for (const property of nodeArray(id, "properties")) {
      const key = propertyName(property);
      if (key !== undefined) push(key, accessor.surface, accessor.name, property);
    }
  });
}

interface Accessor {
  readonly name: string;
  readonly surface: ReadSurface;
}

function accessorOf(node: AstNode): Accessor | null {
  if (node.type === "MemberExpression" && memberName(node) === "runtime") {
    const owner = unwrapExpression(node.object);
    if (identifierName(owner) === "ctx") return { name: "ctx.runtime", surface: "runtime" };
    return null;
  }
  if (node.type !== "CallExpression") return null;
  const callee = identifierName(unwrapExpression(node.callee));
  if (callee === "runtimeEnv") return { name: "runtimeEnv()", surface: "runtime" };
  if (callee === "publicConfig") return { name: "publicConfig()", surface: "public" };
  return null;
}

function isImportMetaEnv(node: AstNode): boolean {
  if (node.type !== "MemberExpression" || memberName(node) !== "env") return false;
  const meta = unwrapExpression(node.object);
  if (meta?.type !== "MetaProperty") return false;
  return identifierName(meta.meta) === "import" && identifierName(meta.property) === "meta";
}

export function runtimeConfigDiagnostics(graph: ModuleGraph, config: ConfigFacts): Diagnostic[] {
  // A static template has no config file, and an unreadable config is already reported: in
  // neither case is there a declaration to verify against.
  if (!config.parsed) return [];
  const access = readRuntimeAccess(graph);
  const diagnostics: Diagnostic[] = [
    ...unsetDiagnostics(config),
    ...readDiagnostics(access.reads, config),
    ...unusedDiagnostics(access.reads, config),
    ...requirementDiagnostics(config),
    ...access.viteEnv.map((read) =>
      warning(
        VITE_ENV_DIRECT,
        "import.meta.env." +
          read.name +
          " is read in project code; declare the value in public and read it with publicConfig()",
        read.source,
      ),
    ),
  ];
  return sortDiagnostics(diagnostics);
}

function runtimeFacts(config: ConfigFacts): Readonly<Record<string, RuntimeKeyFact>> {
  return config.runtimeConfig.runtime;
}

function publicFacts(config: ConfigFacts): Readonly<Record<string, RuntimeKeyFact>> {
  return config.runtimeConfig.public;
}

function surfaceFacts(
  config: ConfigFacts,
  surface: ReadSurface,
): Readonly<Record<string, RuntimeKeyFact>> {
  return surface === "runtime" ? runtimeFacts(config) : publicFacts(config);
}

function sectionLabel(surface: ReadSurface): string {
  return surface === "runtime" ? "runtime" : "public";
}

function unsetDiagnostics(config: ConfigFacts): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const surface of ["runtime", "public"] as const) {
    for (const [key, fact] of Object.entries(surfaceFacts(config, surface))) {
      if (fact.state !== "unset") continue;
      diagnostics.push(
        error(
          RUNTIME_KEY_UNSET,
          sectionLabel(surface) +
            "." +
            key +
            " is declared without a value; write a literal or { secret: true }",
          fact.source,
        ),
      );
    }
  }
  return diagnostics;
}

function readDiagnostics(reads: readonly RuntimeRead[], config: ConfigFacts): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const read of reads) {
    if (surfaceFacts(config, read.surface)[read.key] === undefined) {
      const sectionUnknown =
        read.surface === "runtime"
          ? config.runtimeConfig.runtimeUnknown
          : config.runtimeConfig.publicUnknown;
      // A spread/computed section can hide the key: unknown is never reported as undeclared.
      if (sectionUnknown) continue;
      if (read.surface === "runtime" && publicFacts(config)[read.key] !== undefined) {
        diagnostics.push(
          error(
            RUNTIME_KEY_SERVER_ONLY,
            "public key \"" +
              read.key +
              "\" is declared under public; read it with publicConfig(), not " +
              read.accessor,
            read.source,
          ),
        );
      } else {
        diagnostics.push(
          error(
            RUNTIME_KEY_UNDECLARED,
            read.accessor +
              " reads \"" +
              read.key +
              "\", which facilis.config.ts does not declare under " +
              sectionLabel(read.surface),
            read.source,
          ),
        );
      }
      continue;
    }
    if (read.surface === "runtime" && read.clientReachable) {
      diagnostics.push(
        error(
          RUNTIME_KEY_SERVER_ONLY,
          "runtime key \"" +
            read.key +
            "\" is server-only and cannot be read from src/ (client-reachable) with " +
            read.accessor,
          read.source,
        ),
      );
    }
  }
  return diagnostics;
}

function unusedDiagnostics(reads: readonly RuntimeRead[], config: ConfigFacts): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const surface of ["runtime", "public"] as const) {
    const readKeys = new Set(
      reads.filter((read) => read.surface === surface).map((read) => read.key),
    );
    // A framework key is read by the framework itself at boot, not by app code: only an
    // app-defined key can be unused. Otherwise every project would warn about its own knobs.
    if (surface === "runtime") for (const key of KNOWN_RUNTIME_KEYS) readKeys.add(key);
    for (const [key, fact] of Object.entries(surfaceFacts(config, surface))) {
      if (fact.state === "unset" || readKeys.has(key)) continue;
      diagnostics.push(
        warning(
          RUNTIME_KEY_UNUSED,
          sectionLabel(surface) + "." + key + " is declared but never read",
          fact.source,
        ),
      );
    }
  }
  return diagnostics;
}
