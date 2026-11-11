import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password.ts";

describe("hashPassword / verifyPassword", () => {
  it("encodes a versioned PBKDF2-SHA256 hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^pbkdf2-sha256\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    const [, iterations] = hash.split("$");
    expect(Number(iterations)).toBeGreaterThanOrEqual(600_000);
  });

  it("verifies the right password and rejects the wrong one", async () => {
    const hash = await hashPassword("s3cret!");
    await expect(verifyPassword(hash, "s3cret!")).resolves.toBe(true);
    await expect(verifyPassword(hash, "s3cret?")).resolves.toBe(false);
    await expect(verifyPassword(hash, "")).resolves.toBe(false);
  });

  it("salts every hash so equal passwords encode differently", async () => {
    const [first, second] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(first).not.toBe(second);
    await expect(verifyPassword(first, "same")).resolves.toBe(true);
    await expect(verifyPassword(second, "same")).resolves.toBe(true);
  });

  it("returns false for malformed or unsupported hashes instead of throwing", async () => {
    const malformed = [
      "",
      "plain-text",
      "pbkdf2-sha256$not-a-number$c2FsdHNhbHRzYWx0c2E=$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGE=",
      "pbkdf2-sha256$0$c2FsdHNhbHRzYWx0c2E=$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGE=",
      "pbkdf2-sha256$210000$!!!!$aGFzaA==",
      "md5$210000$c2FsdHNhbHRzYWx0c2E=$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGE=",
      "pbkdf2-sha256$210000$c2FsdA==$aGFzaA==",
    ];
    const results = await Promise.all(malformed.map((hash) => verifyPassword(hash, "anything")));
    expect(results).toEqual(malformed.map(() => false));
  });

  it("round-trips an empty password", async () => {
    const hash = await hashPassword("");
    await expect(verifyPassword(hash, "")).resolves.toBe(true);
  });
});
