/**
 * Rules 9 `no-raw-db-access` and 12 `import-resolves` (SPEC §9.3).
 *
 * Rule 9 keeps raw database clients inside `@facilis/db` (invariant 5); drizzle operators
 * and `drizzle-orm/pg-core` are the schema DSL and stay allowed. Rule 12 checks that every
 * module reference resolves against the effective file set, the project's aliases and the
 * packages package.json declares — no filesystem, no node_modules walk.
 *
 * Both read the analyzer's ImportFacts, so static imports, re-exports, dynamic imports and
 * `require()` share the same AST truth.
 */

import type { EffectiveState } from "../overlay.ts";
import { normalizeProjectPath } from "../paths.ts";
import type { ImportAlias, ImportFact, PatchContext, ValidationError } from "../types.ts";

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

/** Imports deduped per statement: a named-import clause produces one fact per name. */
function statementImports(imports: readonly ImportFact[]): ImportFact[] {
  const seen = new Set<string>();
  const unique: ImportFact[] = [];
  for (const imported of imports) {
    const key = imported.specifier + "\u0000" + imported.source.line;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(imported);
  }
  return unique;
}

export function rawDbAccessErrors(state: EffectiveState): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const facts of state.patchedFileFacts) {
    const imports = statementImports(facts.imports);
    for (const imported of imports) {
      if (!RAW_DRIVER.test(imported.specifier) && !RAW_CLIENTS.has(imported.specifier)) continue;
      errors.push(
        error(
          "no-raw-db-access",
          facts.path,
          'Importing "' + imported.specifier + '" is a raw database client outside @facilis/db.',
          "Go through the policy-scoped db the handler receives (invariant 5).",
          imported.source.line,
        ),
      );
    }
    const rawDrizzleImport = imports.find((imported) => imported.specifier === "drizzle-orm");
    if (rawDrizzleImport !== undefined && facts.calls.some((call) => call.name === "drizzle")) {
      errors.push(
        error(
          "no-raw-db-access",
          facts.path,
          "Constructing a raw drizzle() client is not allowed outside @facilis/db.",
          "Use the policy-scoped db from the handler context; import operators from drizzle-orm instead (invariant 5).",
          rawDrizzleImport.source.line,
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

function aliasBase(specifier: string, aliases: readonly ImportAlias[]): string | null {
  for (const alias of aliases) {
    if (!specifier.startsWith(alias.prefix)) continue;
    return normalizeProjectPath(alias.target + specifier.slice(alias.prefix.length));
  }
  return null;
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

export function importResolveErrors(
  state: EffectiveState,
  context: PatchContext,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const facts of state.patchedFileFacts) {
    for (const imported of statementImports(facts.imports)) {
      const specifier = stripQuery(imported.specifier);
      if (specifier.length === 0) continue;
      if (specifier.startsWith("node:") || NODE_BUILTINS.has(specifier)) continue;
      if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) continue;
      const relative =
        specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
      if (relative) {
        const base = specifier.startsWith("/")
          ? specifier.replace(/^\/+/, "")
          : relativeBase(facts.path, specifier);
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
          facts.path,
          'Import "' + imported.specifier + '" does not resolve.',
          relative
            ? "Point the import at a file that exists (or is created by this patch)."
            : "Use a package declared in package.json; new dependencies need user approval.",
          imported.source.line,
        ),
      );
    }
  }
  return errors;
}
