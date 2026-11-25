import { describe, expect, it } from "vitest";
import { PRERENDER_RENDER_HEADER, renderModeOf } from "./prerender-response";

function headers(map: Record<string, string>): { get(name: string): string | null } {
  return { get: (name) => map[name.toLowerCase()] ?? null };
}

describe("renderModeOf", () => {
  it("reads the middleware marker header", () => {
    expect(renderModeOf(headers({ [PRERENDER_RENDER_HEADER]: "prerender" }), "")).toBe("prerender");
  });

  it("falls back to the state island when the header is absent", () => {
    const body = '<script type="application/json" id="prerender-data">{}</script>';
    expect(renderModeOf(headers({}), body)).toBe("prerender");
  });

  it("treats an unmarked shell as shell", () => {
    expect(renderModeOf(headers({}), '<div id="root"></div>')).toBe("shell");
  });

  it("ignores a wrong header value", () => {
    expect(renderModeOf(headers({ [PRERENDER_RENDER_HEADER]: "shell" }), "")).toBe("shell");
  });
});
