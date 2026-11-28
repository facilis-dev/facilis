import { describe, expect, it } from "vitest";

import {
  parseSecuritySurface,
  SECURITY_SURFACE_FORMAT_VERSION,
  serializeSecuritySurface,
  type SecuritySurfaceDocument,
} from "./security-surface.ts";

const document: SecuritySurfaceDocument = {
  version: SECURITY_SURFACE_FORMAT_VERSION,
  project: "todo-app",
  revision: "rev-1",
  summary: { standard: 1, declared: 1, undeclared: 0, unknown: 0 },
  routes: [
    {
      path: "/api/hooks",
      method: "POST",
      class: "declared",
      auth: "none",
      permission: [],
      dbTables: [],
      declarations: [
        {
          kind: "raw-route",
          reason: "Stripe signature needs the raw body",
          file: "server/api/hooks.post.ts",
          line: 4,
        },
      ],
      source: { file: "server/api/hooks.post.ts", line: 4 },
      warnings: [],
      unknown: [],
    },
  ],
  extensions: [],
  imports: [],
  dynamicCode: [],
  unknown: [],
};

describe("security-surface schema (D-226)", () => {
  it("round-trips a valid document and serializes deterministically", () => {
    const parsed = parseSecuritySurface(document);
    expect(parsed.ok).toBe(true);
    expect(serializeSecuritySurface(document)).toBe(serializeSecuritySurface(document));
    expect(JSON.parse(serializeSecuritySurface(document))["project"]).toBe("todo-app");
  });

  it("rejects a different version and a missing summary bucket", () => {
    expect(parseSecuritySurface({ ...document, version: 2 }).ok).toBe(false);
    expect(
      parseSecuritySurface({ ...document, summary: { standard: 1, declared: 0, undeclared: 0 } })
        .ok,
    ).toBe(false);
  });

  it("rejects a declaration with an empty reason", () => {
    const route = document.routes[0];
    const declaration = route?.declarations[0];
    if (route === undefined || declaration === undefined) throw new Error("fixture is incomplete");
    const broken = {
      ...document,
      routes: [{ ...route, declarations: [{ ...declaration, reason: "" }] }],
    };
    expect(parseSecuritySurface(broken).ok).toBe(false);
  });
});
