import { describe, expect, it } from "vitest";

import { resolveEncryptionKeys } from "./storage-keys.ts";

const KEY = Buffer.alloc(32, 7).toString("base64");
const HEX = "07".repeat(32);

describe("resolveEncryptionKeys", () => {
  it("reads a base64 active key and defaults the key id to primary", () => {
    const resolved = resolveEncryptionKeys({ FACILIS_STORAGE_ENCRYPTION_KEY: KEY });
    expect(resolved.keys).not.toBeNull();
    if (resolved.keys === null) return;
    expect(resolved.keys.activeKeyId).toBe("primary");
    expect(resolved.keys.keys.primary?.byteLength).toBe(32);
  });

  it("accepts hex and a custom key id", () => {
    const resolved = resolveEncryptionKeys({
      FACILIS_STORAGE_ENCRYPTION_KEY: HEX,
      FACILIS_STORAGE_ENCRYPTION_KEY_ID: "release-2026.01",
    });
    if (resolved.keys === null) throw new Error("expected keys");
    expect(resolved.keys.activeKeyId).toBe("release-2026.01");
    expect(Buffer.from(resolved.keys.keys["release-2026.01"] ?? []).toString("hex")).toBe(HEX);
  });

  it("reads retired keys so old blobs keep decrypting", () => {
    const resolved = resolveEncryptionKeys({
      FACILIS_STORAGE_ENCRYPTION_KEY: KEY,
      FACILIS_STORAGE_ENCRYPTION_RETIRED_KEYS: JSON.stringify({
        old: Buffer.alloc(32, 9).toString("base64"),
      }),
    });
    if (resolved.keys === null) throw new Error("expected keys");
    expect(Object.keys(resolved.keys.keys).toSorted()).toEqual(["old", "primary"]);
  });

  it("reports a missing key", () => {
    const resolved = resolveEncryptionKeys({});
    expect(resolved.keys).toBeNull();
    if (resolved.keys !== null) return;
    expect(resolved.problem).toBe("missing");
    expect(resolved.message).toContain("FACILIS_STORAGE_ENCRYPTION_KEY");
  });

  it.each([
    ["not a key", "FACILIS_STORAGE_ENCRYPTION_KEY must be"],
    ["AAAA", "FACILIS_STORAGE_ENCRYPTION_KEY must be"],
    ["!!!!", "FACILIS_STORAGE_ENCRYPTION_KEY must be"],
  ])("rejects a malformed active key %s", (value, expected) => {
    const resolved = resolveEncryptionKeys({ FACILIS_STORAGE_ENCRYPTION_KEY: value });
    expect(resolved.keys).toBeNull();
    if (resolved.keys !== null) return;
    expect(resolved.problem).toBe("invalid");
    expect(resolved.message).toContain(expected);
  });

  it("rejects an invalid key id", () => {
    const resolved = resolveEncryptionKeys({
      FACILIS_STORAGE_ENCRYPTION_KEY: KEY,
      FACILIS_STORAGE_ENCRYPTION_KEY_ID: "bad id",
    });
    expect(resolved.keys).toBeNull();
    if (resolved.keys !== null) return;
    expect(resolved.problem).toBe("invalid");
  });

  it.each([
    ["not json", "FACILIS_STORAGE_ENCRYPTION_RETIRED_KEYS"],
    ["[]", "must be a JSON object"],
    [JSON.stringify({ old: 42 }), "must be a string"],
    [JSON.stringify({ old: KEY, primary: KEY }), "both active and retired"],
  ])("rejects invalid retired keys %s", (retired, expected) => {
    const resolved = resolveEncryptionKeys({
      FACILIS_STORAGE_ENCRYPTION_KEY: KEY,
      FACILIS_STORAGE_ENCRYPTION_RETIRED_KEYS: retired,
    });
    expect(resolved.keys).toBeNull();
    if (resolved.keys !== null) return;
    expect(resolved.problem).toBe("invalid");
    expect(resolved.message).toContain(expected);
  });
});
