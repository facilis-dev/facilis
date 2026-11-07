import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createRolldownParser } from "./rolldown-parser.ts";
import { analyzeProjectRoutes } from "./route-metadata.ts";

const projectRoot = fileURLToPath(new URL("../test-fixtures/project", import.meta.url));

const TS_ROUTE = `import { defineAuthorizedHandler } from "@facilis/core";

const tables = ["todos"] as const;

export default defineAuthorizedHandler(
  {
    permission: "todos:read" as const,
    dbTables: tables,
  },
  async () => tables,
);
`;

describe("createRolldownParser", () => {
  it("returns a TypeScript ESTree program without errors", () => {
    const parsed = createRolldownParser().parse("server/routes/as-const.get.ts", TS_ROUTE);

    expect(parsed.errors).toEqual([]);
    expect(parsed.program.type).toBe("Program");
    // Parsed as TS, not transpiled: `as const` survives as a TS node for the analyzer.
    expect(JSON.stringify(parsed.program)).toContain("TSAsExpression");
  });

  it("maps parser errors to the analyzer's ParseError shape", () => {
    const parsed = createRolldownParser().parse("broken.ts", "const = ;\n");

    expect(parsed.errors.length).toBeGreaterThan(0);
    const error = parsed.errors[0];
    expect(error?.message.length).toBeGreaterThan(0);
    expect(error?.source.file).toBe("broken.ts");
    expect(error?.source.line).toBe(1);
  });

  it("keeps the fixture project's route facts readable through the injected parser", () => {
    const analysis = analyzeProjectRoutes(projectRoot);
    const routes = analysis?.routes.map((fact) => `${fact.method} ${fact.path}`) ?? [];

    expect(routes).toHaveLength(7);
    expect(routes).toContain("GET /api/todos");
    expect(routes).toContain("POST /api/todos");
    expect(routes).toContain("PATCH /api/todos/{id}");
    expect(routes).toContain("GET /health");
    expect(routes).toContain("GET /dynamic");
  });
});
