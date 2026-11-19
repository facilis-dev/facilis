// Regression for issue #51: a recent-project click during a cold start must QUEUE, and
// rapid clicks must collapse into ONE deferred-restore replay + ONE workspace open.
//
// IdeController's constructor wires Monaco, workers and the DOM, which a node test cannot
// instantiate (no controller test exists for that reason). Instead this drives the REAL
// prototype methods — openProject, whenKernelReady, pathInfo — on a minimal store harness
// over a fake bridge (the fakeBridge pattern of project-scaffold.test.ts). The queue, the
// per-root guard and ensureProjectOnDisk are the production code paths, not replicas;
// only the UI side effects (openFolder, registry writes, status) are stubs.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { initI18n, setLocale, t } from "@/i18n";
import type { KernelBridge } from "./kernel";
import { IdeController, type ProjectMeta } from "./controller";
import { createProjectOpenGuard } from "./project-open";

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn(), loading: vi.fn() },
}));

const meta: ProjectMeta = { rootPath: "/w/demo", template: null, createdAt: 0, lastModified: 0 };

function fakeBridge(state: { exists: boolean }) {
  const calls: { type: string; payload: unknown }[] = [];
  const request = vi.fn(async (type: string, payload: unknown) => {
    calls.push({ type, payload });
    if (type === "vv-restore-roots") return { count: 2 };
    if (type === "vv-stat") return { exists: state.exists, isDir: true };
    return { ok: true };
  });
  const post = vi.fn();
  return { bridge: { request, post } as unknown as KernelBridge, calls, post };
}

function harness(bridge: KernelBridge) {
  const listeners = new Set<() => void>();
  return {
    snap: { kernelReady: false },
    listeners,
    // subscribe is a per-instance arrow field on the controller; mirror its plumbing so
    // the REAL whenKernelReady subscribes and resolves exactly as it does in the app.
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    whenKernelReady: IdeController.prototype.whenKernelReady,
    pathInfo: IdeController.prototype.pathInfo,
    openProject: IdeController.prototype.openProject,
    openGuard: createProjectOpenGuard(),
    bridge,
    folderManifests: new Map(),
    status: vi.fn(),
    touchProject: vi.fn(),
    removeProjectMeta: vi.fn(),
    openFolder: vi.fn(),
    openProjectGraph: vi.fn(),
    bumpTree: vi.fn(),
    editorLanguage: { scheduleDependencyTypes: vi.fn() },
  };
}

const replays = (calls: { type: string; payload: unknown }[]) =>
  calls.filter((c) => c.type === "vv-restore-roots");

beforeEach(() => {
  vi.clearAllMocks();
  initI18n();
  setLocale("en");
});

describe("openProject (issue #51)", () => {
  it("queues pre-boot clicks and dedupes five rapid opens to one replay + one open", async () => {
    const { bridge, calls } = fakeBridge({ exists: true });
    const c = harness(bridge);
    const opens = Array.from({ length: 5 }, () => c.openProject(meta));
    // While the boot banner is up nothing touches the VFS and no "still starting" toast
    // drops the click: every call is parked on whenKernelReady.
    expect(replays(calls)).toHaveLength(0);
    expect(toast.info).not.toHaveBeenCalled();
    c.snap.kernelReady = true;
    for (const listener of c.listeners) listener();
    await Promise.all(opens);
    expect(replays(calls)).toHaveLength(1);
    expect(replays(calls)[0].payload).toEqual({ roots: ["/w/demo"] });
    expect(c.openFolder).toHaveBeenCalledTimes(1);
    expect(c.openFolder).toHaveBeenCalledWith("/w/demo");
    expect(c.openProjectGraph).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("shows project.gone, removes the meta and releases the guard for a retry", async () => {
    vi.useFakeTimers();
    try {
      const state = { exists: false };
      const { bridge, calls } = fakeBridge(state);
      const c = harness(bridge);
      c.snap.kernelReady = true;
      const pending = c.openProject(meta);
      // ensureProjectOnDisk gives a concurrent tab's write-behind mirror 3 x 400ms.
      await vi.advanceTimersByTimeAsync(1200);
      await pending;
      expect(toast.error).toHaveBeenCalledWith(t("project.gone"));
      expect(c.removeProjectMeta).toHaveBeenCalledWith("/w/demo");
      expect(c.openFolder).not.toHaveBeenCalled();
      expect(replays(calls)).toHaveLength(4);
      // The guard released the root: once the subtree appears (another tab flushed it),
      // a later click opens the project without another failure.
      state.exists = true;
      await c.openProject(meta);
      expect(c.openFolder).toHaveBeenCalledTimes(1);
      expect(c.openFolder).toHaveBeenCalledWith("/w/demo");
    } finally {
      vi.useRealTimers();
    }
  });
});
