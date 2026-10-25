import { describe, expect, it } from "vitest";

import { hasPermission } from "./index";

const manager = {
  roles: ["manager"],
  permissions: ["todos:read", "todos:write"],
};

describe("hasPermission", () => {
  it("denies anonymous callers", () => {
    expect(hasPermission(null, "todos:read")).toBe(false);
  });

  it("grants a declared permission", () => {
    expect(hasPermission(manager, "todos:write")).toBe(true);
  });

  it("denies an undeclared permission", () => {
    expect(hasPermission(manager, "users:manage")).toBe(false);
  });

  it("treats the wildcard permission as all permissions", () => {
    expect(hasPermission({ roles: ["admin"], permissions: ["*"] }, "users:manage")).toBe(true);
  });
});
