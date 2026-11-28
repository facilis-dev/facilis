import { describe, expect, it } from "vitest";

import { readConfirmed } from "./static-read.ts";

describe("readConfirmed", () => {
  it("reads a provenance object with two non-empty strings", () => {
    expect(readConfirmed({ at: "2026-11-27T20:00:00Z", by: "user:1" })).toEqual({
      at: "2026-11-27T20:00:00Z",
      by: "user:1",
    });
  });

  it("returns undefined for a malformed or empty provenance", () => {
    expect(readConfirmed({ at: "", by: "user:1" })).toBeUndefined();
    expect(readConfirmed({ at: "x" })).toBeUndefined();
    expect(readConfirmed(null)).toBeUndefined();
    expect(readConfirmed("2026-11-27")).toBeUndefined();
  });
});
