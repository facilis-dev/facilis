// The git-worktree reload contract (D-140): open buffers follow the files git rewrote, and a
// buffer with unsaved edits is kept and reported instead of being clobbered.

import { describe, expect, it } from "vitest";
import { createWorkdirReload, type WorkdirReloadHost } from "./workdir-reload";

interface FakeHost extends WorkdirReloadHost {
  readonly calls: string[];
  readonly stored: Map<string, string>;
  readonly reads: string[];
}

function fakeHost(options: {
  tabs: string[];
  dirty?: string[];
  disk?: Record<string, string>;
  fail?: readonly string[];
}): FakeHost {
  const calls: string[] = [];
  const stored = new Map<string, string>();
  const reads: string[] = [];
  const fail = new Set(options.fail ?? []);
  return {
    calls,
    stored,
    reads,
    tabs: () => options.tabs,
    dirty: () => options.dirty ?? [],
    async read(path) {
      reads.push(path);
      if (fail.has(path)) throw new Error("ENOENT");
      return options.disk?.[path] ?? "disk:" + path;
    },
    store(path, text) {
      stored.set(path, text);
    },
    refresh() {
      calls.push("refresh");
    },
    unsavedKept(n) {
      calls.push("unsaved:" + n);
    },
  };
}

/** The callback fires the refresh synchronously and the reload on the microtask queue. */
async function run(host: FakeHost): Promise<void> {
  const callback = createWorkdirReload(host);
  callback();
  await Promise.resolve();
  await Promise.resolve();
}

describe("createWorkdirReload", () => {
  it("refreshes the tree and reloads every clean open buffer", async () => {
    const host = fakeHost({ tabs: ["/w/a.ts", "/w/b.ts"] });
    await run(host);

    expect(host.calls).toEqual(["refresh"]);
    expect([...host.stored]).toEqual([
      ["/w/a.ts", "disk:/w/a.ts"],
      ["/w/b.ts", "disk:/w/b.ts"],
    ]);
  });

  it("keeps a dirty buffer and reports how many were kept", async () => {
    const host = fakeHost({
      tabs: ["/w/a.ts", "/w/b.ts", "/w/c.ts"],
      dirty: ["/w/b.ts", "/w/c.ts"],
    });
    await run(host);

    expect([...host.stored.keys()]).toEqual(["/w/a.ts"]);
    expect(host.reads).not.toContain("/w/b.ts");
    expect(host.reads).not.toContain("/w/c.ts");
    expect(host.calls).toEqual(["refresh", "unsaved:2"]);
  });

  it("does not report anything when every open buffer is dirty or none is open", async () => {
    const noTabs = fakeHost({ tabs: [] });
    await run(noTabs);
    expect(noTabs.calls).toEqual(["refresh"]);

    const allDirty = fakeHost({ tabs: ["/w/a.ts"], dirty: ["/w/a.ts"] });
    await run(allDirty);
    expect(allDirty.calls).toEqual(["refresh", "unsaved:1"]);
  });

  it("leaves a buffer alone when the file is gone after the git operation", async () => {
    const host = fakeHost({ tabs: ["/w/gone.ts", "/w/ok.ts"], fail: ["/w/gone.ts"] });
    await run(host);

    expect([...host.stored.keys()]).toEqual(["/w/ok.ts"]);
    expect(host.calls).toEqual(["refresh"]);
  });
});
