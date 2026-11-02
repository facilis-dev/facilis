/**
 * Rules 9 `no-raw-db-access` and 12 `import-resolves` (SPEC §9.3).
 *
 * Rule 9 keeps raw database clients inside `@facilis/db` (invariant 5); drizzle operators
 * and `drizzle-orm/pg-core` are the schema DSL and stay allowed. Rule 12 checks that every
 * static import resolves against the effective file set, the project's aliases and the
 * packages package.json declares — no filesystem, no node_modules walk.
 */

import type { EffectiveState } from "../overlay.ts";
import { normalizeProjectPath } from "../paths.ts";
import { callsFunction, collectImports, lineAt, maskSource } from "../scan.ts";
import type { PatchContext, ValidationError } from "../types.ts";

const RAW_DRIVER =
  /^drizzle-orm\/(?:pglite|node-postgres|postgres-js|bun-sqlite|neon|vercel-postgres|aws-data-api|libsql|expo-sqlite|d1|op-sqlite|singlestore|tidb-serverless)$/;
const RAW_CLIENTS = new Set(["@electric-sql/pglite", "postgres", "pg"]);

const NODE_BUILTINS = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

const RESOLVABLE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".svg",
];
const HAS_EXTENSION = /\.[A-Za-z0-9]+$/;

function error(
  rule: string,
  file: string,
  message: string,
  fix_hint: string,
  line?: number,
): ValidationError {
  return {
    rule,
    severity: "error",
    file,
    message,
    fix_hint,
    ...(line === undefined ? {} : { line }),
  };
}

function stripQuery(specifier: string): string {
  const cut = specifier.search(/[?#]/);
  return cut === -1 ? specifier : specifier.slice(0, cut);
}

function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) return parts.slice(0, 2).join("/");
  return parts[0] ?? specifier;
}

export function rawDbAccessErrors(state: EffectiveState): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const source of state.patchedSources) {
    const references = collectImports(source.content);
    for (const reference of references) {
      if (!RAW_DRIVER.test(reference.specifier) && !RAW_CLIENTS.has(reference.specifier)) continue;
      errors.push(
        error(
          "no-raw-db-access",
          source.path,
          'Importing "' + reference.specifier + '" is a raw database client outside @facilis/db.',
          "Go through the policy-scoped db the handler receives (invariant 5).",
          lineAt(source.content, reference.index),
        ),
      );
    }
    const rawDrizzleImport = references.find((reference) => reference.specifier === "drizzle-orm");
    if (rawDrizzleImport !== undefined && callsFunction(maskSource(source.content), "drizzle")) {
      errors.push(
        error(
          "no-raw-db-access",
          source.path,
          "Constructing a raw drizzle() client is not allowed outside @facilis/db.",
          "Use the policy-scoped db from the handler context; import operators from drizzle-orm instead (invariant 5).",
          lineAt(source.content, rawDrizzleImport.index),
        ),
      );
    }
  }
  return errors;
}

function fileExists(files: ReadonlySet<string>, base: string): boolean {
  const target = normalizeProjectPath(base);
  if (target.length === 0) return false;
  if (files.has(target)) return true;
  if (HAS_EXTENSION.test(target)) return false;
  for (const extension of RESOLVABLE_EXTENSIONS) {
    if (files.has(target + extension)) return true;
    if (files.has(target + "/index" + extension)) return true;
  }
  return false;
}

function relativeBase(fromPath: string, specifier: string): string {
  const directory = fromPath.split("/").slice(0, -1);
  const segments = [...directory, ...specifier.split("/")];
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.join("/");
}

function aliasBase(specifier: string, aliases: PatchContext["aliases"]): string | null {
  for (const alias of aliases) {
    if (!specifier.startsWith(alias.prefix)) continue;
    return normalizeProjectPath(alias.target + specifier.slice(alias.prefix.length));
  }
  return null;
}

export function importResolveErrors(
  state: EffectiveState,
  context: PatchContext,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const source of state.patchedSources) {
    for (const reference of collectImports(source.content)) {
      const specifier = stripQuery(reference.specifier);
      if (specifier.length === 0) continue;
      if (specifier.startsWith("node:") || NODE_BUILTINS.has(specifier)) continue;
      if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) continue;
      const relative =
        specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
      if (relative) {
        const base = specifier.startsWith("/")
          ? specifier.replace(/^\/+/, "")
          : relativeBase(source.path, specifier);
        if (fileExists(state.files, base)) continue;
      } else {
        const alias = aliasBase(specifier, context.aliases);
        if (alias !== null) {
          if (fileExists(state.files, alias)) continue;
        } else if (context.packages.includes(packageNameOf(specifier))) {
          continue;
        }
      }
      errors.push(
        error(
          "import-resolves",
          source.path,
          'Import "' + reference.specifier + '" does not resolve.',
          relative
            ? "Point the import at a file that exists (or is created by this patch)."
            : "Use a package declared in package.json; new dependencies need user approval.",
          lineAt(source.content, reference.index),
        ),
      );
    }
  }
  return errors;
}
