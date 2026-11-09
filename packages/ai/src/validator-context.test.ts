import { describe, expect, it } from "vitest";

import { CONFIG, create, rulesOf, validate } from "./testing/fixtures.ts";

const ROUTE = "server/routes/api/";

describe("context-free structural rules", () => {
  it("still rejects unsafe paths and missing content without a context", () => {
    expect(
      rulesOf(validate([{ path: "../escape.ts", action: "create", content: "x" }]).result.errors),
    ).toContain("file-path-allowed");
    expect(rulesOf(validate([create("src/App.tsx", "")]).result.errors)).toContain(
      "content-present",
    );
  });
});

describe("rule 1 ts-parse", () => {
  const patch = create("src/feature.ts", "export const value: number = 1;\n");

  it("fails closed when the injected parser is unavailable", () => {
    const { result } = validate([patch], {
      syntax: { status: "unavailable", reason: "worker not loaded" },
    });
    expect(rulesOf(result.errors)).toContain("ts-parse");
    expect(result.errors[0]?.infrastructure).toBe(true);
  });

  it("reports parser findings with line and column", () => {
    const { result } = validate([patch], {
      syntax: {
        status: "checked",
        findings: [{ file: "src/feature.ts", line: 3, column: 5, message: "Unexpected token" }],
      },
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
    expect(validate([patch]).result.ok).toBe(true);
  });
});

describe("rule 2 route-security", () => {
  it("rejects a route that does not use defineAuthorizedHandler", () => {
    const { result } = validate([
      create(ROUTE + "ping.get.ts", "export default async () => new Response('ok');\n"),
    ]);
    expect(rulesOf(result.errors)).toContain("route-security");
  });

  it("rejects a file that calls the wrapper but exports a raw handler", () => {
    const content = `import { defineAuthorizedHandler } from "@facilis/core";

const handler = defineAuthorizedHandler({ permission: [], dbTables: [] }, async () => null);
export default async () => null;
`;
    const { result } = validate([create(ROUTE + "raw.get.ts", content)]);
    expect(rulesOf(result.errors)).toContain("route-security");
    expect(result.errors.find((entry) => entry.rule === "route-security")?.file).toBe(
      ROUTE + "raw.get.ts",
    );
  });

  it("accepts the assign-then-export form", () => {
    const content = `import { defineAuthorizedHandler } from "@facilis/core";

const handler = defineAuthorizedHandler({ permission: [], dbTables: [] }, async () => null);
export default handler;
`;
    const { result } = validate([create(ROUTE + "wrapped.get.ts", content)]);
    expect(rulesOf(result.errors)).not.toContain("route-security");
  });
});

describe("rule 3 db-tables-present", () => {
  it("rejects a route config without dbTables (unknown fails closed)", () => {
    const content = `import { defineAuthorizedHandler } from "@facilis/core";

export default defineAuthorizedHandler({ permission: ["todos:read"] }, async () => null);
`;
    const { result } = validate([create(ROUTE + "ping.get.ts", content)]);
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
    const { result } = validate([create(ROUTE + "missing.get.ts", content)]);
    expect(rulesOf(result.errors)).toContain("db-tables-valid");
  });

  it("rejects removing a table an existing route still references", () => {
    const { result } = validate([
      { path: "db/schema.ts", action: "update", content: "export const removed = true;\n" },
    ]);
    const error = result.errors.find((entry) => entry.rule === "db-tables-valid");
    expect(error?.message).toContain("todos");
  });
});

describe("rule 5 db-columns-valid", () => {
  it("warns about a malformed or unknown column reference", () => {
    const content = `import { defineAuthorizedHandler } from "@facilis/core";

export default defineAuthorizedHandler(
  {
    permission: ["todos:read"],
    dbTables: ["todos"],
    dbColumns: ["todos", "todos.nope"],
    description: "List todos visible to the current user.",
  },
  async () => null,
);
`;
    const { result } = validate([create(ROUTE + "columns.get.ts", content)]);
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
    const { result } = validate([create(ROUTE + "nope.get.ts", content)]);
    expect(rulesOf(result.errors)).toContain("permission-valid");
  });

  it("rejects a route whose permission is unknown (null fails closed)", () => {
    const content = `import { defineAuthorizedHandler } from "@facilis/core";

export default defineAuthorizedHandler({ dbTables: ["todos"] }, async () => null);
`;
    const { result } = validate([create(ROUTE + "anon.get.ts", content)]);
    expect(rulesOf(result.errors)).toContain("permission-valid");
  });

  it("rejects removing a permission an existing route still requires", () => {
    const nextConfig = makeConfig((config) =>
      config.replace('"todos:read", "todos:write"', '"todos:write"'),
    );
    const { result } = validate([
      { path: "facilis.config.ts", action: "update", content: nextConfig },
    ]);
    expect(rulesOf(result.errors)).toContain("permission-valid");
  });
});

function makeConfig(edit: (config: string) => string): string {
  return edit(CONFIG);
}

describe("rule 7 block-import-valid", () => {
  it("accepts an import of a registered block", () => {
    const content = `import { DataTable } from "@facilis/blocks";

export const table = DataTable;
`;
    expect(validate([create("src/table.ts", content)]).result.ok).toBe(true);
  });

  it("rejects an import that matches no BlockManifest", () => {
    const content = `import { Mystery } from "@facilis/blocks";

export const block = Mystery;
`;
    const { result } = validate([create("src/table.ts", content)]);
    expect(rulesOf(result.errors)).toContain("block-import-valid");
  });

  it("reads re-exported block paths too", () => {
    const good = `export { DataTable } from "@facilis/blocks/DataTable";\n`;
    expect(rulesOf(validate([create("src/table.ts", good)]).result.errors)).not.toContain(
      "block-import-valid",
    );
    const bad = `export { Mystery } from "@facilis/blocks/Mystery";\n`;
    expect(rulesOf(validate([create("src/table.ts", bad)]).result.errors)).toContain(
      "block-import-valid",
    );
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
    const { result } = validate([create(ROUTE + "todos/index.post.ts", content)]);
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
    const { result } = validate([create(ROUTE + "todos/index.post.ts", content)]);
    expect(rulesOf(result.errors)).not.toContain("route-input-validated");
  });

  it("does not treat a string mention of body as a body read", () => {
    const content =
      header +
      `
export default defineAuthorizedHandler(
  { permission: ["todos:write"], dbTables: ["todos"] },
  async () => "body",
);
`;
    const { result } = validate([create(ROUTE + "todos/index.post.ts", content)]);
    expect(rulesOf(result.errors)).not.toContain("route-input-validated");
  });

  it("accepts a multipart upload route that declares the form schema", () => {
    const content =
      header +
      `
export default defineAuthorizedHandler(
  {
    permission: ["todos:write"],
    dbTables: ["todos"],
    form: z.object({ title: z.string() }),
  },
  async (_event, { form }) => form,
);
`;
    const { result } = validate([create(ROUTE + "todos/files.post.ts", content)]);
    expect(result.errors).toEqual([]);
  });

  it("rejects a handler that reads the form without a form schema", () => {
    const content =
      header +
      `
export default defineAuthorizedHandler(
  { permission: ["todos:write"], dbTables: ["todos"] },
  async (_event, { form }) => form,
);
`;
    const { result } = validate([create(ROUTE + "todos/files.post.ts", content)]);
    const findings = result.errors.filter((entry) => entry.rule === "route-input-validated");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("multipart");
    expect(findings[0]?.fix_hint).toContain("form: <ZodSchema>");
  });
});
