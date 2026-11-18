import { describe, expect, it } from "vitest";

import { CONFIG, create, rulesOf, SCHEMA, update, validate } from "./testing/fixtures.ts";

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
    const { result } = validate([create("db/client.ts", content)]);
    expect(rulesOf(result.errors)).toContain("no-raw-db-access");
  });

  it("rejects a raw drizzle() client built from the operator package", () => {
    const content = `import { drizzle } from "drizzle-orm";

export const client = drizzle();
`;
    const { result } = validate([create("db/client.ts", content)]);
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
    const { result } = validate([update("db/schema.ts", content)]);
    expect(rulesOf(result.errors)).toContain("rls-on-scoped-table");
  });

  it("rejects dropping the policy from an existing scoped table", () => {
    const withoutPolicies = SCHEMA.replace(
      "  () => [tenantIsolationPolicy(), ownerIsolationPolicy()],\n",
      "",
    ).replace(".enableRLS()", "");
    const { result } = validate([update("db/schema.ts", withoutPolicies)]);
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
    const { result } = validate([update("db/schema.ts", content)]);
    expect(rulesOf(result.errors)).not.toContain("rls-on-scoped-table");
  });
});

describe("rule 11 file-path-allowed", () => {
  it("rejects root files other than facilis.config.ts", () => {
    const { result } = validate([create("package.json", "{}\n")]);
    expect(rulesOf(result.errors)).toContain("file-path-allowed");
  });

  it("allows facilis.config.ts at the root", () => {
    const { result } = validate([update("facilis.config.ts", CONFIG)]);
    expect(result.ok).toBe(true);
  });

  it("rejects a package.json change under the open policy too", () => {
    const { result } = validate([update("package.json", "{}\n")], { writePolicy: "open" });
    expect(rulesOf(result.errors)).toContain("file-path-allowed");
  });

  it("lets an open patch add a GitHub workflow", () => {
    const { result } = validate([create(".github/workflows/ci.yml", "name: ci\non: push\n")], {
      writePolicy: "open",
    });
    expect(rulesOf(result.errors)).not.toContain("file-path-allowed");
  });
});

describe("rule 12 import-resolves", () => {
  it("rejects a relative import that resolves to nothing", () => {
    const content = `import { api } from "./missing";

export const value = api;
`;
    const { result } = validate([create("src/feature.ts", content)]);
    expect(rulesOf(result.errors)).toContain("import-resolves");
  });

  it("accepts relative, alias and installed-package imports", () => {
    const content = `import { api } from "./lib/api";
import { todos } from "~/db/schema";
import { z } from "zod";

export const value = [api, todos, z];
`;
    const { result } = validate([create("src/feature.ts", content)]);
    expect(rulesOf(result.errors)).not.toContain("import-resolves");
  });
});

describe("rule 13 i18n-keys-registered", () => {
  it("warns about a key missing from locales/en.json", () => {
    const content = `import { t } from "./lib/i18n";

export const title = t("missing.key");
`;
    const { result } = validate([create("src/page.ts", content)]);
    expect(rulesOf(result.warnings)).toContain("i18n-keys-registered");
    expect(result.ok).toBe(true);
  });

  it("accepts a registered key", () => {
    const content = `import { t } from "./lib/i18n";

export const title = t("app.title");
`;
    const { result } = validate([create("src/page.ts", content)]);
    expect(rulesOf(result.warnings)).not.toContain("i18n-keys-registered");
  });
});

describe("rule 14 migration-generated", () => {
  it("rejects an authored migration file", () => {
    const { result } = validate([
      create(MIGRATION, "insert into role_permissions values ('user', 'x');\n"),
    ]);
    expect(rulesOf(result.errors)).toContain("migration-generated");
    expect(result.ok).toBe(false);
  });

  it("rejects an edit to an existing migration file", () => {
    const { result } = validate([update(MIGRATION, "-- edited by hand\n")]);
    expect(rulesOf(result.errors)).toContain("migration-generated");
  });

  it("accepts a schema change: the migration is generated at release", () => {
    const { result } = validate([
      update("db/schema.ts", nextSchema("export const extra = true;\n")),
    ]);
    expect(rulesOf(result.errors)).not.toContain("migration-generated");
    expect(result.ok).toBe(true);
  });
});

describe("rule 15 destructive-confirmed", () => {
  const withoutTitle = SCHEMA.replace('    title: text("title").notNull(),\n', "");

  it("rejects a dropped column unless the response is confirmed", () => {
    const { result } = validate([update("db/schema.ts", withoutTitle)]);
    expect(rulesOf(result.errors)).toContain("destructive-confirmed");
  });

  it("accepts a destructive change that requires confirmation", () => {
    const { result } = validate([update("db/schema.ts", withoutTitle)], {
      requiresConfirmation: true,
    });
    expect(rulesOf(result.errors)).not.toContain("destructive-confirmed");
  });

  it("flags the result destructive even when confirmation makes it pass", () => {
    const { result } = validate([update("db/schema.ts", withoutTitle)], {
      requiresConfirmation: true,
    });
    expect(result.ok).toBe(true);
    expect(result.destructive).toBe(true);
  });

  it("does not flag a clean source edit destructive", () => {
    const { result } = validate([create("src/extra.ts", "export const extra = 1;\n")]);
    expect(result.destructive).toBe(false);
  });
});

function configWith(permissions: string, roles: string): string {
  return CONFIG.replace('"todos:read", "todos:write"', permissions).replace(
    'user: ["todos:read", "todos:write"]',
    "user: [" + roles + "]",
  );
}

describe("rule 16 role-config-sync", () => {
  it("accepts a permission change: the seed is generated at release", () => {
    const { result } = validate([
      update(
        "facilis.config.ts",
        configWith('"todos:read", "todos:write", "tags:read"', '"todos:read", "tags:read"'),
      ),
    ]);
    expect(rulesOf(result.errors)).not.toContain("role-config-sync");
  });

  it("rejects a config patch whose auth block cannot be read", () => {
    const { result } = validate([update("facilis.config.ts", "export default 1;\n")]);
    expect(rulesOf(result.errors)).toContain("role-config-sync");
  });
});

describe("integration", () => {
  it("accepts one coherent feature patch: route and permission", () => {
    const config = CONFIG.replace(
      '"todos:read", "todos:write"',
      '"todos:read", "todos:write", "tags:read"',
    ).replace(
      'user: ["todos:read", "todos:write"]',
      'user: ["todos:read", "todos:write", "tags:read"]',
    );
    const route = `import { defineAuthorizedHandler } from "@facilis.dev/core";

export default defineAuthorizedHandler(
  { permission: ["tags:read"], dbTables: ["todos"], dbColumns: ["todos.title"] },
  async () => null,
);
`;
    const { result } = validate([
      update("facilis.config.ts", config),
      create(ROUTE + "tags/index.get.ts", route),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
