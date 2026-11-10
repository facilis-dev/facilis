import { describe, expect, it } from "vitest";

import { emptyAnalysis, routeFact } from "./route-metadata-test-harness.ts";
import { routeMetadataFromAnalysis } from "./route-metadata.ts";

describe("route-metadata crossSite", () => {
  it("keeps null facts unresolved instead of guessing values", () => {
    const metadata = routeMetadataFromAnalysis(
      emptyAnalysis({
        routes: [
          routeFact({
            method: "GET",
            path: "/unknown",
            sourceFile: "server/routes/api/unknown.get.ts",
            permission: null,
            crossSite: null,
            dbTables: null,
            dbColumns: null,
            description: null,
          }),
        ],
      }),
    );

    expect(metadata["/unknown"]?.["get"]).toMatchObject({
      dbTables: [],
      dbColumns: [],
      unresolved: ["permission", "dbTables", "dbColumns", "crossSite"],
    });
    expect(metadata["/unknown"]?.["get"]?.permission).toBeUndefined();
    expect(metadata["/unknown"]?.["get"]?.crossSite).toBeUndefined();
  });

  it("propagates a true crossSite flag and omits a false one", () => {
    const metadata = routeMetadataFromAnalysis(
      emptyAnalysis({
        routes: [
          routeFact({
            method: "POST",
            path: "/api/webhooks",
            sourceFile: "server/routes/api/webhooks.post.ts",
            permission: [],
            crossSite: true,
          }),
          routeFact({
            method: "GET",
            path: "/api/todos",
            sourceFile: "server/routes/api/todos/index.get.ts",
          }),
        ],
      }),
    );

    expect(metadata["/api/webhooks"]?.["post"]?.crossSite).toBe(true);
    expect(metadata["/api/todos"]?.["get"]?.crossSite).toBeUndefined();
    expect(metadata["/api/todos"]?.["get"]?.unresolved).toEqual([]);
  });
});
