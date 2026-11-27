import { inspect } from "node:util";

import { describe, expect, it } from "vitest";

import { REDACTED, SecretString } from "./secret-string.ts";

describe("SecretString", () => {
  it("reveals only on an explicit call", () => {
    expect(new SecretString("value").reveal()).toBe("value");
  });

  it("redacts every implicit string form", () => {
    const secret = new SecretString("value");
    expect(String(secret)).toBe(REDACTED);
    expect(`${secret}`).toBe(REDACTED);
    expect(JSON.stringify({ secret })).toBe(JSON.stringify({ secret: REDACTED }));
    expect(inspect(secret)).toBe(REDACTED);
    expect(inspect({ secret })).not.toContain("value");
  });

  it("is frozen, so a consumer cannot replace what it reads", () => {
    expect(Object.isFrozen(new SecretString("value"))).toBe(true);
  });
});
