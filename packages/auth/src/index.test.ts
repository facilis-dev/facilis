import { describe, expect, it } from "vitest";

import * as auth from "./index.ts";

describe("@facilis.dev/auth public surface", () => {
  it("re-exports the auth tables (Appendix D step 2 pattern)", () => {
    expect(auth.users).toBeDefined();
    expect(auth.sessions).toBeDefined();
    expect(auth.roles).toBeDefined();
    expect(auth.rolePermissions).toBeDefined();
    expect(auth.userRoles).toBeDefined();
  });

  it("exports the Phase 1 contract functions", () => {
    expect(typeof auth.expandRoles).toBe("function");
    expect(typeof auth.hasPermission).toBe("function");
    expect(typeof auth.hashPassword).toBe("function");
    expect(typeof auth.verifyPassword).toBe("function");
    expect(typeof auth.createSession).toBe("function");
    expect(typeof auth.validateSession).toBe("function");
    expect(typeof auth.destroySession).toBe("function");
    expect(typeof auth.sessionMiddleware).toBe("function");
    expect(typeof auth.seedFromConfig).toBe("function");
    expect(typeof auth.seedStatements).toBe("function");
    expect(typeof auth.registerInitialAdmin).toBe("function");
  });

  it("uses the contract cookie name", () => {
    expect(auth.SESSION_COOKIE_NAME).toBe("facilis_session");
  });
});
