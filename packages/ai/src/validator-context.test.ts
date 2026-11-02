import { describe, expect, it } from "vitest";

import { validatePatch } from "./index.ts";
import { create, makeContext, rulesOf, update } from "./testing/fixtures.ts";

const ROUTE = "server/routes/api/";

describe("context-free structural rules", () => {
  it("still rejects unsafe paths and missing content without a context", () => {
    expect(
      rulesOf(validatePatch([{ path: "../escape.ts", action: "create", content: "x" }]).errors),
    ).toContain("file-path-allowed");
    expect(rulesOf(validatePatch([create("src/App.tsx", "")]).errors)).toContain("content-present");
  });
});

describe("rule 1 ts-parse", () => {
  const patch = create("src/feature.ts", "export const value: number = 1;\n");

  it("fails closed when the injected parser is unavailable", () => {
    const result = validatePatch([patch], {
      context: makeContext({ syntax: { status: "unavailable", reason: "worker not loaded" } }),
    });
    expect(rulesOf(result.errors)).toContain("ts-parse");
  });

  it("reports parser findings with line and column", () => {
    const result = validatePatch([patch], {
      context: makeContext({
        syntax: {
          status: "checked",
          findings: [{ file: "src/feature.ts", line: 3, column: 5, message: "Unexpected token" }],
        },
      }),
    });
    const finding = result.errors.find((entry) => entry.rule === "ts-parse");
    expect(finding).toMatchObject({
      file: "src/feature.ts",
      severity: "error",
      line: 3,
      column: 5,
      message: "Unexpected token",
    });
  });

  it("accepts a script file with no findings", () => {
    expect(validatePatch([patch], { context: makeContext() }).ok).toBe(true);
  });
});

describe("rule 2 route-security", () => {
  it("rejects a route that does not use defineAuthorizedHandler", () => {
    const result = validatePatch(
      [create(ROUTE + "ping.get.ts", "export default async () => new Response('ok');\n")],
      {
        context: makeContext(),
      },
    );
    expect(rulesOf(result.errors)).toContain("route-security");
  });
});

describe("rule 2 route-security export target", () => {
  it("rejects a file that calls the wrapper but exports a raw handler", () => {
    const content = `import { defineAuthorizedHandler } from "@facilis/core";

const handler = defineAuthorizedHandler({ permission: [], dbTables: [] }, async () => null);
export default async () => null;
`;
    const result = validatePatch([create(ROUTE + "raw.get.ts", content)], {
      context: makeContext(),
    });
    expect(rulesOf(result.errors)).toContain("route-security");
  });

  it("accepts the assign-then-export form", () => {
    const content = `import { defineAuthorizedHandler } from "@facilis/core";

const handler = defineAuthorizedHandler({ permission: [], dbTables: [] }, async () => null);
export default handler;
`;
    const result = validatePatch([create(ROUTE + "wrapped.get.ts", content)], {
      context: makeContext(),
    });
    expect(rulesOf(result.errors)).not.toContain("route-security");
  });
});

describe("rule 3 db-tables-present", () => {
  it("rejects a route config without dbTables", () => {
    const content = `import { defineAuthorizedHandler } from "@facilis/core";

export default defineAuthorizedHandler({ permission: ["todos:read"] }, async () => null);
`;
    const result = validatePatch([create(ROUTE + "ping.get.ts", content)], {
      context: makeContext(),
    });
    expect(rulesOf(result.errors)).toContain("db-tables-present");
  });
});

describe("rule 4 db-tables-valid", () => {
  it("rejects a dbTables entry that is not in the schema", () => {
    const content = `import { defineAuthorizedHandler } from "@facilis/core";

export default defineAuthorizedHandler(
  { permission: ["todos:read"], dbTables: ["missing"] },
  async () => null,
);
`;
    const result = validatePatch([create(ROUTE + "missing.get.ts", content)], {
      context: makeContext(),
    });
    expect(rulesOf(result.errors)).toContain("db-tables-valid");
  });

  it("rejects removing a table an existing route still references", () => {
    const result = validatePatch([update("db/schema.ts", "export const removed = true;\n")], {
      context: makeContext(),
    });
    const error = result.errors.find((entry) => entry.rule === "db-tables-valid");
    expect(error?.message).toContain("todos");
  });
});

describe("rule 5 db-columns-valid", () => {
  it("warns about a malformed or unknown column reference", () => {
    const content = `import { defineAuthorizedHandler } from "@facilis/core";

export default defineAuthorizedHandler(
  { permission: ["todos:read"], dbTables: ["todos"], dbColumns: ["todos", "todos.nope"] },
  async () => null,
);
`;
    const result = validatePatch([create(ROUTE + "columns.get.ts", content)], {
      context: makeContext(),
    });
    expect(rulesOf(result.warnings)).toEqual(["db-columns-valid", "db-columns-valid"]);
    expect(result.ok).toBe(true);
  });
});

describe("rule 6 permission-valid", () => {
  it("rejects a permission the config does not declare", () => {
    const content = `import { defineAuthorizedHandler } from "@facilis/core";

export default defineAuthorizedHandler(
  { permission: ["nope:read"], dbTables: ["todos"] },
  async () => null,
);
`;
    const result = validatePatch([create(ROUTE + "nope.get.ts", content)], {
      context: makeContext(),
    });
    expect(rulesOf(result.errors)).toContain("permission-valid");
  });

  it("rejects removing a permission an existing route still requires", () => {
    const nextConfig = makeContext().sources["facilis.config.ts"]?.replace(
      '"todos:read", "todos:write"',
      '"todos:write"',
    );
    const context = makeContext();
    const result = validatePatch([update("facilis.config.ts", nextConfig ?? "")], { context });
    expect(rulesOf(result.errors)).toContain("permission-valid");
  });
});

describe("rule 7 block-import-valid", () => {
  it("accepts an import of a registered block", () => {
    const content = `import { DataTable } from "@facilis/blocks";

export const table = DataTable;
`;
    const result = validatePatch([create("src/table.ts", content)], { context: makeContext() });
    expect(result.ok).toBe(true);
  });

  it("rejects an import that matches no BlockManifest", () => {
    const content = `import { Mystery } from "@facilis/blocks";

export const block = Mystery;
`;
    const result = validatePatch([create("src/table.ts", content)], { context: makeContext() });
    expect(rulesOf(result.errors)).toContain("block-import-valid");
  });
});

describe("rule 8 route-input-validated", () => {
  const header = `import { z } from "zod";
import { defineAuthorizedHandler } from "@facilis/core";
`;

  it("rejects a handler that reads the body without a body schema", () => {
    const content =
      header +
      `
export default defineAuthorizedHandler(
  { permission: ["todos:write"], dbTables: ["todos"] },
  async (_event, { body }) => body,
);
`;
    const result = validatePatch([create(ROUTE + "todos/index.post.ts", content)], {
      context: makeContext(),
    });
    expect(rulesOf(result.errors)).toContain("route-input-validated");
  });

  it("accepts a route that declares the body schema", () => {
    const content =
      header +
      `
export default defineAuthorizedHandler(
  { permission: ["todos:write"], dbTables: ["todos"], body: z.object({ title: z.string() }) },
  async (_event, { body }) => body,
);
`;
    const result = validatePatch([create(ROUTE + "todos/index.post.ts", content)], {
      context: makeContext(),
    });
    expect(rulesOf(result.errors)).not.toContain("route-input-validated");
  });
});
