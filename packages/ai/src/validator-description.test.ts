import { describe, expect, it } from "vitest";

import { ROUTE_DESCRIPTION_MAX_CHARS } from "@facilis/analyze";

import { rulesOf, update, validate } from "./testing/fixtures.ts";

const ROUTE = "server/routes/api/todos/index.get.ts";
const DESCRIPTION = "List todos visible to the current user.";

interface RouteOptions {
  /** Omitted means the config has no description at all. */
  description?: string;
  permission?: string;
}

/** The base route fixture, with the description/permission under test in the config. */
function routeSource(options: RouteOptions = {}): string {
  const permission = options.permission ?? "todos:read";
  const description =
    options.description === undefined
      ? ""
      : ",\n    description: " + JSON.stringify(options.description);
  return (
    'import { defineAuthorizedHandler } from "@facilis/core";\n' +
    'import { todos } from "~/db/schema";\n\n' +
    "export default defineAuthorizedHandler(\n" +
    "  {\n" +
    '    permission: ["' +
    permission +
    '"],\n' +
    '    dbTables: ["todos"],\n' +
    '    dbColumns: ["todos.title", "todos.done"]' +
    description +
    ",\n" +
    "  },\n" +
    "  async () => null,\n" +
    ");\n"
  );
}

function updateRoute(options: RouteOptions = {}, sources: Record<string, string> = {}) {
  return validate([update(ROUTE, routeSource(options))], { sources });
}

describe("rule 17 route-description", () => {
  it("stays silent for a current one-sentence description", () => {
    const { result } = updateRoute({ description: DESCRIPTION });
    expect(rulesOf(result.warnings)).not.toContain("route-description");
    expect(result.ok).toBe(true);
  });

  it("warns when the description is missing", () => {
    const { result } = updateRoute();
    const warnings = result.warnings.filter((entry) => entry.rule === "route-description");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ severity: "warning", file: ROUTE });
    expect(warnings[0]?.message).toContain("must declare a description");
    expect(warnings[0]?.fix_hint).toContain("one-sentence description");
    // A warning never blocks the patch (rule-5/13/14 precedent).
    expect(result.ok).toBe(true);
  });

  it("warns when the description is blank", () => {
    const { result } = updateRoute({ description: "   " });
    expect(rulesOf(result.warnings)).toContain("route-description");
  });

  it("warns when the description runs past the two-line budget", () => {
    const { result } = updateRoute({ description: "x".repeat(ROUTE_DESCRIPTION_MAX_CHARS + 1) });
    const warning = result.warnings.find((entry) => entry.rule === "route-description");
    expect(warning?.message).toContain(String(ROUTE_DESCRIPTION_MAX_CHARS + 1));
    expect(warning?.fix_hint).toContain(String(ROUTE_DESCRIPTION_MAX_CHARS));
    expect(result.ok).toBe(true);
  });

  it("warns when the contract changed but the description did not", () => {
    const before = routeSource({ description: DESCRIPTION });
    const { result } = updateRoute(
      { description: DESCRIPTION, permission: "todos:write" },
      {
        [ROUTE]: before,
      },
    );
    const warning = result.warnings.find((entry) => entry.rule === "route-description");
    expect(warning).toMatchObject({ severity: "warning", file: ROUTE });
    expect(warning?.message).toContain("may no longer be accurate");
    expect(result.ok).toBe(true);
  });

  it("stays silent when the description is unchanged and so is the contract", () => {
    const before = routeSource({ description: DESCRIPTION });
    const { result } = updateRoute({ description: DESCRIPTION }, { [ROUTE]: before });
    expect(rulesOf(result.warnings)).not.toContain("route-description");
  });
});
