/**
 * Shared fixtures for the validator tests: a realistic todo-app project analyzed with
 * @facilis.dev/analyze, plus the patch overlay applied to its file map.
 *
 * Tests build the effective (post-patch) Analysis exactly as the IDE does — project the
 * patch onto the pre-patch file map and analyze the result — so every rule runs against
 * AST facts instead of a tolerant text scan.
 */

import {
  buildProjectContext,
  validatePatch,
  type FilePatch,
  type ImportAlias,
  type PatchContext,
  type SyntaxCheck,
  type ValidatePatchOptions,
  type ValidationResult,
} from "../index.ts";
import { normalizeProjectPath } from "../paths.ts";
import { analyzeProjectSources } from "../node.ts";

export const CONFIG = `import { defineConfig } from "@facilis.dev/core";

export default defineConfig({
  release: { ref: "origin/main" },
  db: { mode: "pglite", migrationsDir: "db/migrations" },
  i18n: { defaultLocale: "en", locales: ["en"] },
  auth: {
    permissions: ["todos:read", "todos:write"],
    roles: { admin: ["*"], user: ["todos:read", "todos:write"] },
    defaultRole: "user",
  },
});
`;

export const CONFIG_IT = CONFIG.replace(
  'i18n: { defaultLocale: "en", locales: ["en"] },',
  'i18n: { defaultLocale: "it", locales: ["en", "it"] },',
);

export const SCHEMA = `import { boolean, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { ownerIsolationPolicy, tenantColumn, tenantIsolationPolicy } from "@facilis.dev/db";

export const todos = pgTable(
  "todos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantColumn(),
    ownerId: uuid("owner_id").notNull(),
    title: text("title").notNull(),
    done: boolean("done").notNull().default(false),
  },
  () => [tenantIsolationPolicy(), ownerIsolationPolicy()],
).enableRLS();
`;

const LOCALES =
  JSON.stringify({ "app.title": "Facilis todos", "todos.title": "Todos" }, null, 2) + "\n";

const PACKAGE_JSON =
  JSON.stringify(
    {
      dependencies: {
        "@facilis.dev/blocks": "workspace:*",
        "@facilis.dev/core": "workspace:*",
        "@facilis.dev/db": "workspace:*",
        "drizzle-orm": "0.45.4",
        react: "19.3.1",
        zod: "4.6.7",
      },
      devDependencies: { typescript: "7.0.2", vite: "8.3.5" },
    },
    null,
    2,
  ) + "\n";

const TSCONFIG = JSON.stringify({ compilerOptions: { paths: { "~/*": ["./*"] } } }, null, 2) + "\n";

export const ROUTE_SOURCE = `import { z } from "zod";
import { defineAuthorizedHandler } from "@facilis.dev/core";
import { todos } from "~/db/schema";

export default defineAuthorizedHandler(
  {
    permission: ["todos:read"],
    query: z.object({ includeDone: z.enum(["true", "false"]).optional() }),
    dbTables: ["todos"],
    dbColumns: ["todos.title", "todos.done"],
  },
  async (_event, { query, db }) => db.select().from(todos),
);
`;

/** Path aliases the Node analyzer gets, mirroring tsconfig's "~/*": ["./*"]. */
const ANALYZER_ALIASES: readonly ImportAlias[] = [{ prefix: "~/", target: "" }];

/** Registered blocks and a manifest-only catalog key (the fallback merge test reads it). */
export function manifest(): unknown {
  return {
    blocks: [{ name: "DataTable" }, { name: "ResourceForm" }],
    i18n: { defaultLocale: "en", catalogs: { en: { "manifest.only": "Manifest fallback" } } },
  };
}

export const BASE_SOURCES: Readonly<Record<string, string>> = {
  "facilis.config.ts": CONFIG,
  "db/schema.ts": SCHEMA,
  "locales/en.json": LOCALES,
  "locales/it.json": LOCALES,
  "package.json": PACKAGE_JSON,
  "tsconfig.json": TSCONFIG,
  "server/routes/api/todos/index.get.ts": ROUTE_SOURCE,
  "src/lib/i18n.ts": "export const t = (key: string) => key;\n",
  "src/lib/api.ts": "export const api = true;\n",
};

/** Project the patch set onto a file map, like the IDE's apply-to-VFS projection. */
export function applyPatches(
  base: ReadonlyMap<string, string>,
  patches: readonly FilePatch[],
): Map<string, string> {
  const files = new Map(base);
  for (const patch of patches) {
    const path = normalizeProjectPath(patch.path);
    if (patch.action === "delete") {
      files.delete(path);
      continue;
    }
    if (typeof patch.content === "string") files.set(path, patch.content);
  }
  return files;
}

export interface ContextOptions {
  /** Base-source overrides (the pre-patch project). */
  sources?: Readonly<Record<string, string>>;
  /** Base files to drop (e.g. locales/en.json, to exercise the locale fallback). */
  omit?: readonly string[];
  /** Pre-patch file list; defaults to the base source keys. */
  files?: readonly string[];
  manifest?: unknown;
  syntax?: SyntaxCheck;
  packages?: readonly string[];
  aliases?: readonly ImportAlias[];
}

/** Build the effective PatchContext for one patch set. */
export function makeContext(
  patches: readonly FilePatch[] = [],
  options: ContextOptions = {},
): PatchContext {
  const base: Record<string, string> = { ...BASE_SOURCES, ...options.sources };
  for (const path of options.omit ?? []) delete base[path];
  const baseMap = new Map(Object.entries(base));
  const effectiveMap = applyPatches(baseMap, patches);
  const before = analyzeProjectSources(baseMap, ANALYZER_ALIASES);
  const analysis = analyzeProjectSources(effectiveMap, ANALYZER_ALIASES);
  const sources: Record<string, string> = {};
  for (const path of ["package.json", "tsconfig.json"]) {
    const content = effectiveMap.get(path);
    if (content !== undefined) sources[path] = content;
  }
  const project = buildProjectContext({
    files: options.files ?? [...baseMap.keys()],
    analysis,
    before,
    manifest: options.manifest === undefined ? manifest() : options.manifest,
    sources,
    ...(options.packages === undefined ? {} : { packages: options.packages }),
    ...(options.aliases === undefined ? {} : { aliases: options.aliases }),
  });
  return { ...project, syntax: options.syntax ?? { status: "checked", findings: [] } };
}

export interface ValidateOptions extends ContextOptions {
  requiresConfirmation?: boolean;
  allowedRootFiles?: readonly string[];
}

/** Build the context for the patch set, then validate it (the IDE's whole round). */
export function validate(
  patches: readonly FilePatch[],
  options: ValidateOptions = {},
): { result: ValidationResult; context: PatchContext } {
  const context = makeContext(patches, options);
  const overrides: Pick<ValidatePatchOptions, "requiresConfirmation" | "allowedRootFiles"> = {};
  if (options.requiresConfirmation !== undefined) {
    overrides.requiresConfirmation = options.requiresConfirmation;
  }
  if (options.allowedRootFiles !== undefined) overrides.allowedRootFiles = options.allowedRootFiles;
  const result = validatePatch(patches, { context, ...overrides });
  return { result, context };
}

export function create(path: string, content: string): FilePatch {
  return { path, action: "create", content };
}

export function update(path: string, content: string): FilePatch {
  return { path, action: "update", content };
}

export function remove(path: string): FilePatch {
  return { path, action: "delete" };
}

export function rulesOf(entries: readonly { rule: string }[]): string[] {
  return entries.map((entry) => entry.rule);
}
