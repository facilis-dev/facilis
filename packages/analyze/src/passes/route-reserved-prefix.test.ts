import { describe, expect, it } from "vitest";

import { createModuleGraph } from "../module-graph.ts";
import { createOxcParser } from "../node.ts";
import { emptyConfigFacts } from "./config.ts";
import { reservedRoutePrefixDiagnostics } from "./route-reserved-prefix.ts";
import { buildRouteFacts } from "./routes.ts";

const CORE = 'import { defineAuthorizedHandler } from "@facilis.dev/core";\n';
const CODE = "reserved-route-prefix";

function source(): string {
  return (
    CORE +
    "export default defineAuthorizedHandler({ permission: [], dbTables: [] }, async () => null);\n"
  );
}

function diagnostics(path: string) {
  const graph = createModuleGraph({
    files: new Map([[path, source()]]),
    parser: createOxcParser(),
  });
  const facts = buildRouteFacts(graph, emptyConfigFacts());
  return reservedRoutePrefixDiagnostics(facts.routes);
}

function codes(path: string): string[] {
  return diagnostics(path).map((entry) => entry.code);
}

describe("reserved route prefix (invariant 6, D-215)", () => {
  it("errors on a project route under the framework control plane", () => {
    for (const path of [
      "server/routes/__facilis/x.get.ts",
      "server/routes/__facilis/index.get.ts",
      "server/routes/__facilis/dev/query.post.ts",
      "server/routes/__facilis/telemetry/v1/traces.post.ts",
    ]) {
      expect(codes(path), path).toEqual([CODE]);
    }
  });

  it("errors on the framework OpenAPI routes", () => {
    expect(codes("server/routes/_openapi.json.get.ts")).toEqual([CODE]);
    expect(codes("server/routes/_facilis/openapi.json.get.ts")).toEqual([CODE]);
  });

  it("errors on the SSO namespace and the token endpoint", () => {
    for (const path of [
      "server/routes/api/auth/sso.get.ts",
      "server/routes/api/auth/sso/[provider]/start.get.ts",
      "server/routes/api/auth/sso/[provider]/callback.get.ts",
      "server/routes/api/auth/token.post.ts",
    ]) {
      expect(codes(path), path).toEqual([CODE]);
    }
  });

  it("reports the shadowed path, the why and the source in the diagnostic", () => {
    const [entry] = diagnostics("server/routes/api/auth/token.post.ts");
    expect(entry?.message).toContain('"/api/auth/token"');
    expect(entry?.message).toContain("token endpoint");
    expect(entry?.severity).toBe("error");
    expect(entry?.source?.file).toBe("server/routes/api/auth/token.post.ts");
  });

  it("passes the routes the shipped apps legitimately own", () => {
    for (const path of [
      "server/routes/api/auth/login.post.ts",
      "server/routes/api/auth/verify-email.get.ts",
      "server/routes/api/files/[id].get.ts",
      "server/routes/api/jobs/index.post.ts",
      "server/routes/api/jobs/[id].get.ts",
      "server/routes/api/todos/index.get.ts",
      "server/routes/health.get.ts",
      "server/routes/_openapi.get.ts",
    ]) {
      expect(codes(path), path).toEqual([]);
    }
  });

  it("matches on whole segments, so a lookalike app path is not reserved", () => {
    for (const path of [
      "server/routes/__facilisx.get.ts",
      "server/routes/api/auth/tokenizer.post.ts",
      "server/routes/api/auth/ssox.get.ts",
    ]) {
      expect(codes(path), path).toEqual([]);
    }
  });
});
