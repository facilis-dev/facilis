import { describe, expect, it } from "vitest";
import { hasPermission } from "./session.tsx";

describe("hasPermission", () => {
  it("is false without an authenticated session", () => {
    expect(hasPermission(null, "todos:read")).toBe(false);
    expect(hasPermission({ authenticated: false }, "todos:read")).toBe(false);
  });

  it("checks the session permission list", () => {
    const session = { authenticated: true, permissions: ["todos:read", "todos:write"] };
    expect(hasPermission(session, "todos:write")).toBe(true);
    expect(hasPermission(session, "users:read")).toBe(false);
    expect(hasPermission({ authenticated: true }, "todos:read")).toBe(false);
  });
});
