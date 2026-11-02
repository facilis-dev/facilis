/**
 * Shared fixtures for the validator tests: a realistic todo-app context.
 *
 * Sources are parsed by the same `buildProjectContext` the IDE uses, so the tests cover
 * the context builder and the rules together instead of hand-writing parsed facts.
 */

import {
  buildProjectContext,
  type FilePatch,
  type PatchContext,
  type SyntaxCheck,
} from "../index.ts";

export const CONFIG = `import { defineConfig } from "@facilis/core";

export default defineConfig({
  release: { ref: "origin/main" },
  db: { mode: "pglite", migrationsDir: "db/migrations" },
  i18n: { defaultLocale: "en", locales: ["en"] },
  blocks: { packages: ["@facilis/blocks"] },
  auth: {
    permissions: ["todos:read", "todos:write"],
    roles: { admin: ["*"], user: ["todos:read", "todos:write"] },
    defaultRole: "user",
  },
});
`;

export const SCHEMA = `import { boolean, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { ownerIsolationPolicy, tenantColumn, tenantIsolationPolicy } from "@facilis/db";

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
        "@facilis/blocks": "workspace:*",
        "@facilis/core": "workspace:*",
        "@facilis/db": "workspace:*",
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
import { defineAuthorizedHandler } from "@facilis/core";
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

export function manifest(): unknown {
  return {
    project: {
      config: {
        db: { migrationsDir: "db/migrations" },
        i18n: { defaultLocale: "en", locales: ["en"] },
        blocks: { packages: ["@facilis/blocks"] },
        auth: {
          permissions: ["todos:read", "todos:write"],
          roles: { admin: ["*"], user: ["todos:read", "todos:write"] },
          defaultRole: "user",
        },
      },
    },
    routes: [
      {
        method: "GET",
        path: "/api/todos",
        permission: ["todos:read"],
        dbTables: ["todos"],
        dbColumns: ["todos.title"],
        security: "required",
        sourceFile: "server/routes/api/todos/index.get.ts",
      },
    ],
    blocks: [{ name: "DataTable" }, { name: "ResourceForm" }],
    schema: { tables: [] },
    i18n: { defaultLocale: "en", catalogs: { en: { "app.title": "Facilis todos" } } },
  };
}

export const BASE_FILES = [
  "facilis.config.ts",
  "db/schema.ts",
  "db/migrations/meta/_journal.json",
  "locales/en.json",
  "locales/it.json",
  "package.json",
  "tsconfig.json",
  "server/routes/api/todos/index.get.ts",
  "src/app.tsx",
  "src/lib/i18n.ts",
  "src/lib/api.ts",
];

export interface ContextOptions {
  files?: readonly string[];
  sources?: Readonly<Record<string, string>>;
  manifest?: unknown;
  syntax?: SyntaxCheck;
}

/** Build a full {@link PatchContext} for a validator test. */
export function makeContext(options: ContextOptions = {}): PatchContext {
  const sources: Record<string, string> = {
    "facilis.config.ts": CONFIG,
    "db/schema.ts": SCHEMA,
    "locales/en.json": LOCALES,
    "locales/it.json": LOCALES,
    "package.json": PACKAGE_JSON,
    "tsconfig.json": TSCONFIG,
    "server/routes/api/todos/index.get.ts": ROUTE_SOURCE,
    "src/lib/i18n.ts": "export const t = (key: string) => key;\n",
    "src/lib/api.ts": "export const api = true;\n",
    ...options.sources,
  };
  const files = options.files ?? [...BASE_FILES, ...Object.keys(sources)];
  const project = buildProjectContext({
    files,
    sources,
    ...(options.manifest === undefined ? { manifest: manifest() } : { manifest: options.manifest }),
  });
  return { ...project, syntax: options.syntax ?? { status: "checked", findings: [] } };
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
