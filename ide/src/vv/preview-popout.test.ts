import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KernelBridge } from "./kernel";
import { openPreviewWindow, pickExternalPort } from "./preview-popout";

// The pop-out helpers only touch window.open; the bridge is a documented stub, like the
// preview-session test's.
function fakeBridge(patch: { mode?: string; popoutIsolated?: boolean } = {}): KernelBridge {
  return {
    mode: patch.mode ?? "same-origin",
    popoutIsolated: patch.popoutIsolated ?? false,
    previewUrlFor: (port: number, path: string) => `https://p${port}.preview.test${path}`,
    sameOriginPreviewUrl: (port: number, path: string) =>
      `/preview/${port}${path}?__vv_kernel=token`,
  } as unknown as KernelBridge;
}

beforeEach(() => {
  vi.stubGlobal("window", { open: vi.fn(() => ({})), __vvBoot: [] });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openPreviewWindow", () => {
  it("reports success when the browser opened the tab", () => {
    expect(openPreviewWindow(fakeBridge(), 3000)).toBe(true);
    expect(window.open).toHaveBeenCalledWith("/preview/3000/?__vv_kernel=token", "_blank");
  });

  it("reports a blocked pop-up instead of pretending it opened", () => {
    vi.stubGlobal("window", { open: () => null, __vvBoot: [] });
    expect(openPreviewWindow(fakeBridge(), 3000)).toBe(false);
  });

  it("opens a wildcard preview at the origin root", () => {
    openPreviewWindow(fakeBridge({ mode: "wildcard" }), 4200);
    expect(window.open).toHaveBeenCalledWith("https://p4200.preview.test/", "_blank");
  });
});

const listening = (...ports: number[]) => ports.map((port) => ({ port, pid: 1 }));

describe("pickExternalPort", () => {
  it("prefers the active folder's running app over another project's preview tab", () => {
    expect(pickExternalPort(3000, 4000, listening(4000))).toBe(3000);
  });

  it("falls back to the active preview tab", () => {
    expect(pickExternalPort(null, 4000, listening(4000))).toBe(4000);
  });

  it("falls back to the only listening port", () => {
    expect(pickExternalPort(null, null, listening(5173))).toBe(5173);
  });

  it("does not guess between several listening ports", () => {
    expect(pickExternalPort(null, null, listening(5173, 8787))).toBeNull();
  });

  it("is null when nothing is running", () => {
    expect(pickExternalPort(null, null, [])).toBeNull();
  });
});
