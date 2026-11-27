// The runtime lens's live adapter (D-224 §4, #199): unavailable is a code, and a stopped
// preview or a production build never yields an available source.

import { describe, expect, it } from "vitest";
import type { KernelBridge } from "@/vv/kernel";
import { createRuntimeLensSource } from "./runtime-lens-source.ts";

function bridge(): KernelBridge {
  return {
    mode: "same-origin",
    sameOriginPreviewUrl: () => "http://ide.test/preview/5173/?__vv_kernel=boot-token",
    isTrustedPreviewOrigin: () => true,
  } as unknown as KernelBridge;
}

const previewWith = (port: number | null) => ({
  activePreviewTab: () => (port === null ? null : { id: "tab", port }),
  frameFor: () => undefined,
});

describe("runtime lens source", () => {
  it("is unavailable with a translated reason when no preview runs", () => {
    const source = createRuntimeLensSource({ bridge: bridge(), preview: previewWith(null) });
    expect(source.availability?.("runtime")).toEqual({
      available: false,
      reasonKey: "projectGraph.surface.state.notRunning",
    });
  });

  it("is unavailable in a production build", () => {
    const source = createRuntimeLensSource({ bridge: bridge(), preview: previewWith(5173) }, false);
    expect(source.availability?.("runtime")).toEqual({
      available: false,
      reasonKey: "projectGraph.surface.state.devOnly",
    });
  });

  it("is available with a running preview and a kernel token", () => {
    const source = createRuntimeLensSource({ bridge: bridge(), preview: previewWith(5173) });
    expect(source.availability?.("runtime")).toEqual({ available: true, reasonKey: null });
    expect(source.source).toBe("live");
  });

  it("reads the collector's window as its state", () => {
    const source = createRuntimeLensSource({ bridge: bridge(), preview: previewWith(5173) });
    expect(source.state?.("runtime", { view: null })).toMatchObject({ facts: [] });
  });
});
