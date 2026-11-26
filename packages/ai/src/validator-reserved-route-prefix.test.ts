import { describe, expect, it } from "vitest";

import { create, rulesOf, validate } from "./testing/fixtures.ts";

const CORE = 'import { defineAuthorizedHandler } from "@facilis.dev/core";\n';
const RULE = "reserved-route-prefix";

function route(): string {
  return (
    CORE +
    "export default defineAuthorizedHandler({ permission: [], dbTables: [] }, async () => null);\n"
  );
}

describe("rule 23 reserved-route-prefix (invariant 6, D-215)", () => {
  it("rejects a new route under the framework control plane", () => {
    const { result } = validate([create("server/routes/__facilis/x.get.ts", route())]);
    expect(rulesOf(result.errors)).toContain(RULE);
    expect(result.ok).toBe(false);
  });

  it("rejects a route that shadows the token endpoint", () => {
    const { result } = validate([create("server/routes/api/auth/token.post.ts", route())]);
    expect(rulesOf(result.errors)).toContain(RULE);
    expect(result.ok).toBe(false);
  });

  it("rejects a route inside the SSO namespace", () => {
    const { result } = validate([create("server/routes/api/auth/sso/callback.get.ts", route())]);
    expect(rulesOf(result.errors)).toContain(RULE);
    expect(result.ok).toBe(false);
  });

  it("reports the route file and the framework path", () => {
    const { result } = validate([create("server/routes/api/auth/token.post.ts", route())]);
    const finding = result.errors.find((entry) => entry.rule === RULE);
    expect(finding?.file).toBe("server/routes/api/auth/token.post.ts");
    expect(finding?.message).toContain('"/api/auth/token"');
  });

  it("passes an app route on a path the framework does not register", () => {
    for (const path of [
      "server/routes/api/auth/login.post.ts",
      "server/routes/api/files/[id].get.ts",
      "server/routes/api/jobs/index.post.ts",
      "server/routes/api/todos/index.get.ts",
      "server/routes/health.get.ts",
    ]) {
      const { result } = validate([create(path, route())]);
      expect(rulesOf(result.errors), path).not.toContain(RULE);
      expect(result.ok, path).toBe(true);
    }
  });

  it("does not flag a lookalike application path", () => {
    const { result } = validate([create("server/routes/__facilisx.get.ts", route())]);
    expect(rulesOf(result.errors)).not.toContain(RULE);
    expect(result.ok).toBe(true);
  });
});
