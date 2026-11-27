// The changes lens's read-only source (#200): a walk on open, a debounced refresh while open,
// no refresh after close, and no write path at all — the injected reader is the only side.

import { describe, expect, it } from "vitest";
import type { WorktreeSnapshot } from "@/ai/git-checkpoint";
import type { KernelBridge } from "@/vv/kernel";
import type { ProjectGraphView } from "../graph-model";
import { createChangesLensSource } from "./changes-lens-source.ts";

const SNAPSHOT: WorktreeSnapshot = {
  base: "0123456789abcdef",
  changes: [{ path: "src/a.ts", letter: "M" }],
  failure: null,
};

const VIEW = {
  nodes: [
    {
      id: "page:src/a.ts",
      kind: "page",
      label: "src/a.ts",
      sourceFile: "src/a.ts",
      position: { x: 0, y: 0 },
      matched: true,
      collapsed: false,
      data: {
        kind: "page",
        pagePath: "src/a.ts",
        pageKind: "page",
        callCount: 0,
        routePaths: [],
        preview: null,
      },
    },
  ],
  edges: [],
  stats: {
    pages: 1,
    routes: 0,
    tables: 0,
    views: 0,
    workflows: 0,
    edges: 0,
    hiddenEdges: 0,
    hiddenNodes: 0,
    matches: 0,
    unknownNodes: 0,
    pageLinks: 0,
    elevatedEdges: 0,
  },
} as ProjectGraphView;

function controller() {
  const listeners = new Set<() => void>();
  const state = { subscribed: 0, unsubscribed: 0 };
  return {
    state,
    controller: {
      bridge: {} as KernelBridge,
      activeFolder: { rootPath: "/project" },
      subscribe: (listener: () => void) => {
        state.subscribed += 1;
        listeners.add(listener);
        return () => {
          state.unsubscribed += 1;
          listeners.delete(listener);
        };
      },
      notify: () => {
        for (const listener of listeners) listener();
      },
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("changes lens source", () => {
  it("walks on open, publishes the facts and unsubscribes on close", async () => {
    const { controller: c, state } = controller();
    let reads = 0;
    const source = createChangesLensSource(c, async () => {
      reads += 1;
      return SNAPSHOT;
    });
    let notified = 0;
    const off = source.subscribe?.(() => {
      notified += 1;
    });
    source.activate?.("changes", { view: VIEW });
    await settle();
    expect(reads).toBe(1);
    expect(notified).toBe(1);
    expect(source.state?.("changes", { view: VIEW })?.facts).toHaveLength(1);
    expect(state.subscribed).toBe(1);
    source.deactivate?.("changes");
    expect(state.unsubscribed).toBe(1);
    expect(source.state?.("changes", { view: VIEW })?.emptyKey).toBe(
      "projectGraph.surface.state.changes.loading",
    );
    off?.();
  });

  it("never walks again after deactivation", async () => {
    const { controller: c } = controller();
    let reads = 0;
    const source = createChangesLensSource(c, async () => {
      reads += 1;
      return SNAPSHOT;
    });
    source.activate?.("changes", { view: VIEW });
    await settle();
    source.deactivate?.("changes");
    await settle();
    expect(reads).toBe(1);
  });

  it("publishes a code when the walk fails instead of throwing", async () => {
    const { controller: c } = controller();
    const source = createChangesLensSource(c, async () => {
      throw new Error("bridge down");
    });
    source.activate?.("changes", { view: VIEW });
    await settle();
    expect(source.state?.("changes", { view: VIEW })?.emptyKey).toBe(
      "projectGraph.surface.state.changes.error",
    );
  });
});
