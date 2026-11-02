import { describe, expect, it } from "vitest";

import { validatePatch } from "./index.ts";
import { create, makeContext, rulesOf, SCHEMA, update } from "./testing/fixtures.ts";

const ROUTE = "server/routes/api/";
const MIGRATION = "db/migrations/0002_roles.sql";

function nextSchema(extra: string): string {
  return SCHEMA + extra;
}

describe("rule 9 no-raw-db-access", () => {
  it("rejects a raw drizzle driver import", () => {
    const content = `import { drizzle } from "drizzle-orm/pglite";

export const client = drizzle();
`;
    const result = validatePatch([create("db/client.ts", content)], { context: makeContext() });
    expect(rulesOf(result.errors)).toContain("no-raw-db-access");
  });
});

describe("rule 10 rls-on-scoped-table", () => {
  it("rejects a new scoped table without its RLS policy", () => {
    const content = nextSchema(`
export const notes = pgTable("notes", {
  id: uuid("id").primaryKey(),
  tenantId: tenantColumn(),
  title: text("title").notNull(),
});
`);
    const result = validatePatch([update("db/schema.ts", content)], { context: makeContext() });
    expect(rulesOf(result.errors)).toContain("rls-on-scoped-table");
  });

  it("rejects dropping the policy from an existing scoped table", () => {
    const withoutPolicies = SCHEMA.replace(
      "  () => [tenantIsolationPolicy(), ownerIsolationPolicy()],\n",
      "",
    ).replace(".enableRLS()", "");
    const result = validatePatch([update("db/schema.ts", withoutPolicies)], {
      context: makeContext(),
    });
    expect(rulesOf(result.errors)).toContain("rls-on-scoped-table");
  });

  it("accepts a new scoped table that ships the policy", () => {
    const content = nextSchema(`
export const notes = pgTable(
  "notes",
  { id: uuid("id").primaryKey(), tenantId: tenantColumn(), title: text("title").notNull() },
  () => [tenantIsolationPolicy()],
).enableRLS();
`);
    const result = validatePatch(
      [
        update("db/schema.ts", content),
        create("db/migrations/0002_notes.sql", "create table notes();\n"),
      ],
      { context: makeContext() },
    );
    expect(rulesOf(result.errors)).not.toContain("rls-on-scoped-table");
  });
});

describe("rule 11 file-path-allowed", () => {
  it("rejects root files other than facilis.config.ts", () => {
    const result = validatePatch([create("package.json", "{}\n")], { context: makeContext() });
    expect(rulesOf(result.errors)).toContain("file-path-allowed");
  });

  it("allows facilis.config.ts at the root", () => {
    const context = makeContext();
    const result = validatePatch(
      [update("facilis.config.ts", context.sources["facilis.config.ts"] ?? "")],
      {
        context,
      },
    );
    expect(result.ok).toBe(true);
  });
});

describe("rule 12 import-resolves", () => {
  it("rejects a relative import that resolves to nothing", () => {
    const content = `import { api } from "./missing";

export const value = api;
`;
    const result = validatePatch([create("src/feature.ts", content)], { context: makeContext() });
    expect(rulesOf(result.errors)).toContain("import-resolves");
  });

  it("accepts relative, alias and installed-package imports", () => {
    const content = `import { api } from "./lib/api";
import { todos } from "~/db/schema";
import { z } from "zod";

export const value = [api, todos, z];
`;
    const result = validatePatch([create("src/feature.ts", content)], { context: makeContext() });
    expect(rulesOf(result.errors)).not.toContain("import-resolves");
  });
});

describe("rule 13 i18n-keys-registered", () => {
  it("warns about a key missing from locales/en.json", () => {
    const content = `import { t } from "./lib/i18n";

export const title = t("missing.key");
`;
    const result = validatePatch([create("src/page.ts", content)], { context: makeContext() });
    expect(rulesOf(result.warnings)).toContain("i18n-keys-registered");
    expect(result.ok).toBe(true);
  });

  it("accepts a registered key", () => {
    const content = `import { t } from "./lib/i18n";

export const title = t("app.title");
`;
    const result = validatePatch([create("src/page.ts", content)], { context: makeContext() });
    expect(rulesOf(result.warnings)).not.toContain("i18n-keys-registered");
  });
});

describe("rule 14 migration-generated", () => {
  it("warns when a schema change ships no migration", () => {
    const result = validatePatch(
      [update("db/schema.ts", nextSchema("export const extra = true;\n"))],
      {
        context: makeContext(),
      },
    );
    expect(result.warnings.some((entry) => entry.rule === "migration-generated")).toBe(true);
  });

  it("accepts a schema change with a migration file", () => {
    const result = validatePatch(
      [
        update("db/schema.ts", nextSchema("export const extra = true;\n")),
        create("db/migrations/0002_extra.sql", "-- extra\n"),
      ],
      { context: makeContext() },
    );
    expect(result.warnings.some((entry) => entry.rule === "migration-generated")).toBe(false);
  });
});

describe("rule 15 destructive-confirmed", () => {
  const withoutTitle = SCHEMA.replace('    title: text("title").notNull(),\n', "");

  it("rejects a dropped column unless the response is confirmed", () => {
    const result = validatePatch([update("db/schema.ts", withoutTitle)], {
      context: makeContext(),
    });
    expect(rulesOf(result.errors)).toContain("destructive-confirmed");
  });

  it("accepts a destructive change that requires confirmation", () => {
    const result = validatePatch([update("db/schema.ts", withoutTitle)], {
      context: makeContext(),
      requiresConfirmation: true,
    });
    expect(rulesOf(result.errors)).not.toContain("destructive-confirmed");
  });
});

function configWith(permissions: string, roles: string): string {
  const context = makeContext();
  return (context.sources["facilis.config.ts"] ?? "")
    .replace('"todos:read", "todos:write"', permissions)
    .replace('user: ["todos:read", "todos:write"]', "user: [" + roles + "]");
}

describe("rule 16 role-config-sync", () => {
  it("rejects a permission change without a seed migration", () => {
    const result = validatePatch(
      [
        update(
          "facilis.config.ts",
          configWith('"todos:read", "todos:write", "tags:read"', '"todos:read", "tags:read"'),
        ),
      ],
      { context: makeContext() },
    );
    expect(rulesOf(result.errors)).toContain("role-config-sync");
  });

  it("rejects a config patch whose auth block cannot be read", () => {
    const result = validatePatch([update("facilis.config.ts", "export default 1;\n")], {
      context: makeContext(),
    });
    expect(rulesOf(result.errors)).toContain("role-config-sync");
  });

  it("accepts a permission change that ships the seed migration", () => {
    const result = validatePatch(
      [
        update(
          "facilis.config.ts",
          configWith('"todos:read", "todos:write", "tags:read"', '"todos:read", "tags:read"'),
        ),
        create(MIGRATION, "insert into role_permissions values ('user', 'tags:read');\n"),
      ],
      { context: makeContext() },
    );
    expect(rulesOf(result.errors)).not.toContain("role-config-sync");
  });
});

describe("integration", () => {
  it("accepts one coherent feature patch: route, permission and migration", () => {
    const context = makeContext();
    const config = (context.sources["facilis.config.ts"] ?? "")
      .replace('"todos:read", "todos:write"', '"todos:read", "todos:write", "tags:read"')
      .replace(
        'user: ["todos:read", "todos:write"]',
        'user: ["todos:read", "todos:write", "tags:read"]',
      );
    const route = `import { defineAuthorizedHandler } from "@facilis/core";

export default defineAuthorizedHandler(
  { permission: ["tags:read"], dbTables: ["todos"], dbColumns: ["todos.title"] },
  async () => null,
);
`;
    const result = validatePatch(
      [
        update("facilis.config.ts", config),
        create(MIGRATION, "insert into role_permissions values ('user', 'tags:read');\n"),
        create(ROUTE + "tags/index.get.ts", route),
      ],
      { context },
    );
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
