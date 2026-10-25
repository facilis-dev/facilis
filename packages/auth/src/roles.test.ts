import { describe, expect, it } from "vitest";

import { expandRoles, hasPermission, type AuthConfig } from "./roles.ts";

const config: AuthConfig = {
  permissions: ["todos:read", "todos:write", "users:read"],
  roles: {
    admin: ["*"],
    manager: ["todos:read", "todos:write"],
    user: ["todos:read"],
    duplicated: ["todos:read", "todos:read"],
  },
  defaultRole: "user",
  sessionDurationMs: 1000,
};

describe("expandRoles", () => {
  it("expands the wildcard role to every configured permission in config order", () => {
    expect(expandRoles(["admin"], config)).toEqual(["todos:read", "todos:write", "users:read"]);
  });

  it("flattens roles in input order and dedupes permissions", () => {
    expect(expandRoles(["user", "manager"], config)).toEqual(["todos:read", "todos:write"]);
    expect(expandRoles(["admin", "manager"], config)).toEqual([
      "todos:read",
      "todos:write",
      "users:read",
    ]);
  });

  it("ignores unknown roles and returns a fresh deterministic array", () => {
    expect(expandRoles(["ghost"], config)).toEqual([]);
    expect(expandRoles([], config)).toEqual([]);
    expect(expandRoles(["manager"], config)).toEqual(expandRoles(["manager"], config));
    const first = expandRoles(["manager"], config);
    first.push("mutated");
    expect(expandRoles(["manager"], config)).toEqual(["todos:read", "todos:write"]);
  });

  it("dedupes duplicate permission entries declared in one role", () => {
    expect(expandRoles(["duplicated"], config)).toEqual(["todos:read"]);
  });
});

describe("hasPermission", () => {
  const manager = { permissions: ["todos:read", "todos:write"] };

  it("denies anonymous subjects when a permission is required", () => {
    expect(hasPermission(null, "todos:read")).toBe(false);
    expect(hasPermission(null, ["todos:read"])).toBe(false);
  });

  it("grants when the single permission matches", () => {
    expect(hasPermission(manager, "todos:write")).toBe(true);
    expect(hasPermission(manager, "users:read")).toBe(false);
  });

  it("grants when at least one of the required permissions matches", () => {
    expect(hasPermission(manager, ["users:manage", "todos:read"])).toBe(true);
    expect(hasPermission(manager, ["users:manage", "users:read"])).toBe(false);
  });

  it("treats an empty permission list as public (contract §4.4)", () => {
    expect(hasPermission(manager, [])).toBe(true);
    expect(hasPermission(null, [])).toBe(true);
  });

  it("honours a literal wildcard permission as a safety net", () => {
    expect(hasPermission({ permissions: ["*"] }, "users:manage")).toBe(true);
  });
});
