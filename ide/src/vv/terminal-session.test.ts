// The panel-visibility contract of the terminal runtime (D-124): the bottom panel
// starts closed and nothing opens it implicitly. The regression these tests pin:
// replacing a project closes its active run terminal, and the fallback switch to the
// next shell used to force the panel open — which collapsed the project-graph canvas
// at the smoke viewport (issue #180).

import { describe, expect, it, vi } from "vitest";
import type { KernelBridge } from "./kernel";
import {
  TerminalSession,
  type TerminalHost,
  type TerminalMeta,
  type TerminalPatch,
} from "./terminal-session";

// xterm needs a DOM to render; the session logic under test only drives the entry
// lifecycle, so a headless stub stands in for the real terminal + fit addon.
vi.mock("./terminal-theme", () => ({
  createXterm: () => {
    const term = {
      cols: 80,
      rows: 24,
      options: {} as Record<string, unknown>,
      onData: () => ({ dispose: () => {} }),
      onResize: () => ({ dispose: () => {} }),
      write: () => {},
      dispose: () => {},
      focus: () => {},
      clear: () => {},
    };
    return { term, fit: { fit: () => {} } };
  },
  termThemeFor: () => ({}),
}));

function makeBridge(): { bridge: KernelBridge; posts: { type: string; extra: unknown }[] } {
  const posts: { type: string; extra: unknown }[] = [];
  const bridge = {
    post: (type: string, extra: unknown) => {
      posts.push({ type, extra });
    },
  } as unknown as KernelBridge;
  return { bridge, posts };
}

function makeHost(panelCollapsed: boolean) {
  const state = {
    activeTermId: null as string | null,
    panelTab: "console" as "console" | "terminal" | "ports",
    panelCollapsed,
    terminals: [] as TerminalMeta[],
  };
  const host: TerminalHost = {
    patch: (patch: TerminalPatch) => Object.assign(state, patch),
    activeTermId: () => state.activeTermId,
    panelTab: () => state.panelTab,
    activeFolderRoot: () => null,
    theme: () => "dark",
  };
  return { host, state };
}

// switchTerminal fits + focuses on the next frame; run it synchronously in the test.
vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
  cb();
  return 0;
});

describe("TerminalSession panel visibility (D-124)", () => {
  it("closing the active run terminal keeps a closed panel closed", () => {
    const { bridge } = makeBridge();
    const { host, state } = makeHost(true);
    const session = new TerminalSession(bridge, host);
    const boot = session.newShellTerminal({ label: "sh 1", activate: false });
    const run = session.newShellTerminal({
      cwd: "/home/user/projects/alpha",
      run: "npm run dev",
      label: "npm run dev",
      activate: false,
    });
    // A run no longer opens the panel, but its shell is still the active terminal.
    expect(state.activeTermId).toBe(run);
    expect(state.panelCollapsed).toBe(true);

    session.closeTerminal(run);

    expect(state.activeTermId).toBe(boot);
    expect(state.panelTab).toBe("terminal");
    expect(state.panelCollapsed).toBe(true);
  });

  it("closing the active run terminal keeps an open panel open", () => {
    const { bridge } = makeBridge();
    const { host, state } = makeHost(false);
    const session = new TerminalSession(bridge, host);
    const boot = session.newShellTerminal({ label: "sh 1", activate: false });
    const run = session.newShellTerminal({ run: "npm run dev", activate: false });

    session.closeTerminal(run);

    expect(state.activeTermId).toBe(boot);
    expect(state.panelCollapsed).toBe(false);
  });

  it("an explicit switch still opens the panel", () => {
    const { bridge } = makeBridge();
    const { host, state } = makeHost(true);
    const session = new TerminalSession(bridge, host);
    const shell = session.newShellTerminal({ label: "sh 1", activate: false });
    expect(state.panelCollapsed).toBe(true);

    session.switchTerminal(shell);

    expect(state.activeTermId).toBe(shell);
    expect(state.panelCollapsed).toBe(false);
  });

  it("closing the last shell falls back to the console without opening the panel", () => {
    const { bridge, posts } = makeBridge();
    const { host, state } = makeHost(true);
    const session = new TerminalSession(bridge, host);
    const run = session.newShellTerminal({ run: "npm run dev", activate: false });

    session.closeTerminal(run);

    expect(state.activeTermId).toBeNull();
    expect(state.panelTab).toBe("console");
    expect(state.panelCollapsed).toBe(true);
    expect(posts.some((p) => p.type === "term-close")).toBe(true);
  });
});
