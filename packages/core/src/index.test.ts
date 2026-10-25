import { describe, expect, it } from "vitest";

import { defineConfig } from "./index";

describe("defineConfig", () => {
  it("returns the provided config unchanged", () => {
    const config = defineConfig({
      auth: {
        permissions: ["todos:read", "todos:write"],
        roles: { admin: ["todos:read", "todos:write"], user: ["todos:read"] },
        defaultRole: "user",
      },
    });

    expect(config.auth.defaultRole).toBe("user");
    expect(config.auth.permissions).toEqual(["todos:read", "todos:write"]);
  });
});
