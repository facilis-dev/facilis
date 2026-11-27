import { describe, expect, it } from "vitest";
import { parseSecuritySurface } from "@facilis.dev/core";

import { buildSecuritySurfaceDocument, securitySurfaceIssues } from "./security-surface.ts";
import { emptyAnalysis, routeFact } from "./route-metadata-test-harness.ts";

const ROUTE = routeFact({
  method: "POST",
  path: "/api/hooks",
  sourceFile: "server/api/hooks.post.ts",
  auth: "none",
  surface: {
    class: "declared",
    declarations: [
      {
        kind: "raw-route",
        reason: "signed webhook",
        source: { file: "server/api/hooks.post.ts", line: 3 },
      },
    ],
    source: { file: "server/api/hooks.post.ts", line: 3 },
    unknown: [],
    rawSqlReason: null,
    rawDb: [],
  },
});

const ANALYSIS = emptyAnalysis({
  revision: "rev-1",
  routes: [ROUTE],
  surface: {
    extensions: [],
    forbiddenImports: [
      {
        file: "server/api/x.get.ts",
        specifier: "@facilis.dev/db",
        imported: "createDb",
        source: { file: "server/api/x.get.ts", line: 2 },
      },
    ],
    dynamicCode: [],
    unknown: [],
    summary: { standard: 0, declared: 1, undeclared: 0, unknown: 0 },
  },
});

describe("security-surface document (D-226)", () => {
  it("maps the analyzer facts into the versioned document", () => {
    const document = buildSecuritySurfaceDocument(ANALYSIS, "todo-app");
    expect(parseSecuritySurface(document).ok).toBe(true);
    expect(document.routes[0]?.declarations[0]?.reason).toBe("signed webhook");
    expect(document.imports[0]?.symbol).toBe("createDb");
    expect(document.summary).toMatchObject({ declared: 1, undeclared: 1 });
  });

  it("is deterministic for the same analysis", () => {
    expect(JSON.stringify(buildSecuritySurfaceDocument(ANALYSIS, "todo-app"))).toBe(
      JSON.stringify(buildSecuritySurfaceDocument(ANALYSIS, "todo-app")),
    );
  });

  it("reports undeclared surfaces as gate issues", () => {
    const issues = securitySurfaceIssues(ANALYSIS);
    expect(issues.map((issue) => issue.code).toSorted()).toEqual(["surface-forbidden-import"]);
  });
});
