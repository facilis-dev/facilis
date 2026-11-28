import { describe, expect, it } from "vitest";

import { defineServerExtension } from "./server-extension.ts";
import { isFacilisServerExtension, SurfaceDeclarationError } from "./surface.ts";

describe("defineServerExtension", () => {
  it("requires a non-empty reason and a known kind", () => {
    const plugin = () => undefined;
    expect(() => defineServerExtension({ reason: "" }, plugin)).toThrow(SurfaceDeclarationError);
    expect(() => defineServerExtension({ reason: "x", kind: "worker" as never }, plugin)).toThrow(
      /unknown server-extension kind/,
    );
  });

  it("returns the exact export and brands it", () => {
    const middleware = { name: "request-id" };
    const declared = defineServerExtension({ reason: "request id header" }, middleware);
    expect(declared).toBe(middleware);
    expect(isFacilisServerExtension(declared)).toBe(true);
    expect(isFacilisServerExtension({ name: "lookalike" })).toBe(false);
  });
});
