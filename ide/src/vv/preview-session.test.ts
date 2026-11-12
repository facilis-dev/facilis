import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KernelBridge } from "./kernel";
import {
  PreviewSession,
  type PreviewHost,
  type PreviewState,
  type PreviewTab,
} from "./preview-session";

// pointPreview records a boot mark, which writes window.__vvBoot: the node test environment
// has no window, so a bare object stands in for the sink.
beforeEach(() => {
  vi.stubGlobal("window", { __vvBoot: [] });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// The session only needs the preview slice of the snapshot: a mutable fake host is enough to
// assert how a dev server binds a tab, with the kernel bridge left as a documented stub cast.
function makeSession(tabs: PreviewTab[]) {
  let state: PreviewState = {
    tabs,
    activeId: tabs[0]?.id ?? null,
    devtoolsOpen: false,
    devtoolsNonce: 0,
  };
  const patches: { previewCollapsed?: boolean }[] = [];
  const host: PreviewHost = {
    state: () => state,
    update: (patch) => {
      patches.push({ previewCollapsed: patch.previewCollapsed });
      state = { ...state, ...patch };
    },
    keepPrefixPorts: () => [],
    status: () => undefined,
    endRunPhase: () => undefined,
  };
  const bridge = {} as unknown as KernelBridge;
  return { session: new PreviewSession(bridge, host), current: () => state, patches };
}

const tab = (overrides: Partial<PreviewTab> = {}): PreviewTab => ({
  id: "pv1",
  url: "",
  port: null,
  path: "/todos",
  nonce: 1,
  ...overrides,
});

describe("PreviewSession.pointPreview", () => {
  it("binds a pending tab instead of stacking a dead one, keeping its path", () => {
    const { session, current, patches } = makeSession([tab()]);
    session.pointPreview(3000);
    const tabs = current().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ id: "pv1", port: 3000, path: "/todos", url: "localhost:3000" });
    expect(tabs[0]?.nonce).toBe(2);
    expect(current().activeId).toBe("pv1");
    expect(patches.some((patch) => patch.previewCollapsed === false)).toBe(true);
  });

  it("creates a tab at the root when none is waiting", () => {
    const { session, current } = makeSession([tab({ id: "pv1", port: 3000 })]);
    session.pointPreview(4000);
    const tabs = current().tabs;
    expect(tabs).toHaveLength(2);
    expect(tabs[1]).toMatchObject({ port: 4000, path: "/" });
  });
});
