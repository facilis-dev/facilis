// The in-VM prerender run over a fake kernel bridge (issue #85): phases, the managed
// terminal mirror, framework-code failures, the budget timeout and the busy guard.

import { afterEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n";
import type { KernelMessage } from "@/vv/kernel";
import {
  getPrerenderRun,
  parseBuildFailure,
  PRERENDER_BUILD_TIMEOUT_MS,
  runPrerenderBuild,
  type PrerenderRunBridge,
  type PrerenderRunDeps,
  type PrerenderRunTerminals,
} from "./prerender-run";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { toast } from "sonner";

// The assertions check localized strings, so the catalogues must be registered.
initI18n();

const ROOT = "/home/user/projects/app";
const LOCKFILE = ROOT + "/node_modules/.package-lock.json";
const STAMP = ROOT + "/.facilis/prerender.json";

function fakeKernel() {
  const files = new Map<string, string>();
  const handlers = new Map<string, Set<(m: KernelMessage) => void>>();
  const posts: Array<{ type: string; extra: Record<string, unknown> }> = [];
  const emit = (type: string, m: Record<string, unknown>) => {
    for (const handler of handlers.get(type) ?? []) handler({ type, ...m });
  };
  const bridge: PrerenderRunBridge = {
    post: (type, extra = {}) => {
      posts.push({ type, extra });
    },
    request: async (type, extra = {}) => {
      const path = String(extra.path ?? "");
      if (type === "vv-read") {
        return files.has(path)
          ? { type: "vv-reply", ok: true, contents: files.get(path) }
          : { type: "vv-reply", ok: false };
      }
      return { type: "vv-reply", ok: false };
    },
    on: (type, handler) => {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    },
  };
  const spawned: Array<{ cwd?: string | null; label?: string | null }> = [];
  const closed: string[] = [];
  const writes: string[] = [];
  const terminals: PrerenderRunTerminals = {
    newShellTerminal: (opts) => {
      spawned.push(opts);
      return "sh-build-" + spawned.length;
    },
    writeTo: (_id, chunk) => {
      writes.push(chunk);
    },
    closeTerminal: (id) => {
      closed.push(id);
    },
  };
  const status = vi.fn();
  const deps: PrerenderRunDeps = { bridge, terminals, status };
  const execId = () => String(posts.find((p) => p.type === "proc-spawn")?.extra.execId ?? "");
  return { deps, files, spawned, closed, writes, posts, emit, status, execId };
}

/** The runner reads the VFS before spawning; wait until the terminal is live. */
async function started(phase: "installing" | "building"): Promise<void> {
  await vi.waitFor(() => expect(getPrerenderRun()?.phase).toBe(phase));
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("runPrerenderBuild", () => {
  it("spawns npm run build, mirrors output into the terminal and reports ready", async () => {
    const k = fakeKernel();
    k.files.set(LOCKFILE, "{}");
    k.files.set(STAMP, JSON.stringify({ routes: ["/", "/about"], builtAt: 1 }));
    const pending = runPrerenderBuild(k.deps, ROOT);
    await started("building");
    expect(k.spawned[0]).toMatchObject({ cwd: ROOT, activate: false });
    expect(k.posts[0]).toMatchObject({
      type: "proc-spawn",
      extra: { command: "sh", args: ["-c", "npm run build"], cwd: ROOT },
    });
    k.emit("proc-out", { execId: k.execId(), chunk: "vite v7.3.8 building for production..." });
    expect(k.writes.join("")).toContain("vite v7.3.8");
    k.emit("proc-exit", { execId: k.execId(), code: 0 });
    const result = await pending;
    expect(result.phase).toBe("ready");
    expect(result.routes).toEqual(["/", "/about"]);
    expect(result.durationMs).not.toBeNull();
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("installs first when the npm lockfile is absent and advances installing → building", async () => {
    const k = fakeKernel();
    const pending = runPrerenderBuild(k.deps, ROOT);
    await started("installing");
    expect(k.posts[0]?.extra.args).toEqual(["-c", "npm install && npm run build"]);
    k.emit("proc-out", { execId: k.execId(), chunk: "added 200 packages in 9s" });
    expect(getPrerenderRun()?.phase).toBe("installing");
    k.emit("proc-out", { execId: k.execId(), chunk: "vite v7.3.8 building for production..." });
    expect(getPrerenderRun()?.phase).toBe("building");
    k.emit("proc-exit", { execId: k.execId(), code: 0 });
    expect((await pending).phase).toBe("ready");
  });

  it("surfaces the framework code and the localized reason on an ineligible build", async () => {
    const k = fakeKernel();
    k.files.set(LOCKFILE, "{}");
    const pending = runPrerenderBuild(k.deps, ROOT);
    await started("building");
    k.emit("proc-out", {
      execId: k.execId(),
      chunk: '[facilis] prerender-ineligible: route "/todos" is not prerender-eligible (auth-guarded)',
    });
    k.emit("proc-exit", { execId: k.execId(), code: 1 });
    const result = await pending;
    expect(result.phase).toBe("failed");
    expect(result.errorCode).toBe("prerender-ineligible");
    expect(result.error).toContain("/todos");
    expect(result.error).toContain("auth-guarded");
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("reports a plain VM failure by exit code when no framework line is present", async () => {
    const k = fakeKernel();
    k.files.set(LOCKFILE, "{}");
    const pending = runPrerenderBuild(k.deps, ROOT);
    await started("building");
    k.emit("proc-exit", { execId: k.execId(), code: 137 });
    const result = await pending;
    expect(result.phase).toBe("failed");
    expect(result.errorCode).toBeNull();
    expect(result.error).toContain("137");
  });

  it("stops a hung build at the budget timeout and keeps the dev server untouched", async () => {
    vi.useFakeTimers();
    const k = fakeKernel();
    k.files.set(LOCKFILE, "{}");
    const pending = runPrerenderBuild(k.deps, ROOT);
    // Flush the VFS read microtasks so the spawn lands under fake timers.
    await vi.advanceTimersByTimeAsync(0);
    expect(getPrerenderRun()?.phase).toBe("building");
    await vi.advanceTimersByTimeAsync(PRERENDER_BUILD_TIMEOUT_MS);
    const result = await pending;
    expect(result.phase).toBe("failed");
    expect(result.error).toContain("600");
    expect(k.posts.some((p) => p.type === "proc-kill")).toBe(true);
    expect(k.closed).toEqual(["sh-build-1"]);
  });

  it("refuses a second concurrent build without spawning another process", async () => {
    const k = fakeKernel();
    k.files.set(LOCKFILE, "{}");
    const first = runPrerenderBuild(k.deps, ROOT);
    await started("building");
    const second = await runPrerenderBuild(k.deps, ROOT);
    expect(second.phase).toBe("building");
    expect(k.posts.filter((p) => p.type === "proc-spawn")).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledTimes(1);
    k.emit("proc-exit", { execId: k.execId(), code: 0 });
    await first;
  });

  it("ignores output and exits from other executions", async () => {
    const k = fakeKernel();
    k.files.set(LOCKFILE, "{}");
    const pending = runPrerenderBuild(k.deps, ROOT);
    await started("building");
    k.emit("proc-out", {
      execId: "someone-else",
      chunk: '[facilis] prerender-ineligible: route "/x" is not prerender-eligible (redirect)',
    });
    k.emit("proc-exit", { execId: "someone-else", code: 1 });
    expect(getPrerenderRun()?.phase).toBe("building");
    k.emit("proc-exit", { execId: k.execId(), code: 0 });
    expect((await pending).phase).toBe("ready");
  });
});

describe("parseBuildFailure", () => {
  it("localizes a private-api reason with the offending route", () => {
    const failure = parseBuildFailure(
      '[facilis] prerender-ineligible: route "/stats" is not prerender-eligible (private-api: GET /api/stats)',
      1,
    );
    expect(failure.code).toBe("prerender-ineligible");
    expect(failure.message).toContain("GET /api/stats");
  });

  it("passes a generic framework prerender error through as the detail", () => {
    const failure = parseBuildFailure("[facilis] prerender: the project analysis is unavailable", 1);
    expect(failure.code).toBeNull();
    expect(failure.message).toContain("the project analysis is unavailable");
  });
});
