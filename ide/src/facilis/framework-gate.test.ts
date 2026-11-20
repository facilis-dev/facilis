// The D-198 boot gate end to end over a fake kernel bridge: block, update through the
// D-070 engine (npm-install postflight included), rollback on failure, decline.

import { afterEach, describe, expect, it, vi } from "vitest";
import { environmentVersion, frameworkPackageMinimums } from "@/deploy/current";
import type { KernelMessage } from "@/vv/kernel";
import { APP_MANIFEST_FILE, parseAppManifest, renderAppManifest } from "./app-manifest";
import {
  acceptFrameworkUpdate,
  declineFrameworkUpdate,
  dismissFrameworkGate,
  frameworkRunGate,
  getFrameworkGate,
  type GateBridge,
} from "./framework-gate";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { toast } from "sonner";

const ROOT = "/home/user/projects/app";
const PKG = ROOT + "/package.json";
const MARKER = ROOT + "/" + APP_MANIFEST_FILE;
const CORE_MINIMUM = frameworkPackageMinimums["@facilis.dev/core"];

const BELOW =
  JSON.stringify(
    { name: "facilis-app", dependencies: { "@facilis.dev/core": "0.0.0", react: "19.3.0" } },
    null,
    2,
  ) + "\n";

function fakeBridge(installExit = 0) {
  const files = new Map<string, string>();
  const handlers = new Map<string, Set<(m: KernelMessage) => void>>();
  const posts: Array<{ type: string; extra: Record<string, unknown> }> = [];
  const emit = (type: string, m: Record<string, unknown>) => {
    for (const handler of handlers.get(type) ?? []) handler({ type, ...m });
  };
  const bridge: GateBridge = {
    request: async (type, extra = {}) => {
      const path = String(extra.path ?? "");
      if (type === "vv-read") {
        return files.has(path)
          ? { type: "vv-reply", ok: true, contents: files.get(path) }
          : { type: "vv-reply", ok: false };
      }
      if (type === "vv-write") {
        files.set(path, String(extra.contents));
        return { type: "vv-reply", ok: true };
      }
      if (type === "vv-rm") {
        files.delete(path);
        return { type: "vv-reply", ok: true };
      }
      return { type: "vv-reply", ok: false };
    },
    post: (type, extra = {}) => {
      posts.push({ type, extra });
      // The fake kernel "runs" npm install and reports its exit asynchronously.
      if (type === "proc-spawn") {
        setTimeout(() => emit("proc-exit", { execId: extra.execId, code: installExit }), 0);
      }
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
  return { bridge, files, posts };
}

afterEach(() => {
  dismissFrameworkGate();
  vi.clearAllMocks();
});

describe("frameworkRunGate", () => {
  it("boots when every pin satisfies its minimum", async () => {
    const { bridge, files } = fakeBridge();
    files.set(PKG, JSON.stringify({ dependencies: { "@facilis.dev/core": CORE_MINIMUM } }));
    const start = vi.fn();
    await frameworkRunGate(bridge, ROOT, start);
    expect(start).toHaveBeenCalledTimes(1);
    expect(getFrameworkGate()).toBeNull();
  });

  it("boots projects without a package.json or without framework deps", async () => {
    const { bridge, files } = fakeBridge();
    const start = vi.fn();
    await frameworkRunGate(bridge, ROOT, start);
    expect(start).toHaveBeenCalledTimes(1);
    files.set(PKG, JSON.stringify({ dependencies: { react: "19.3.0" } }));
    await frameworkRunGate(bridge, ROOT, start);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("boots dev-local file: pins (D-196)", async () => {
    const { bridge, files } = fakeBridge();
    files.set(
      PKG,
      JSON.stringify({ dependencies: { "@facilis.dev/core": "file:./vendor/facilis/core" } }),
    );
    const start = vi.fn();
    await frameworkRunGate(bridge, ROOT, start);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("blocks a below-minimum project and raises the prompt instead of booting", async () => {
    const { bridge, files } = fakeBridge();
    files.set(PKG, BELOW);
    const start = vi.fn();
    await frameworkRunGate(bridge, ROOT, start);
    expect(start).not.toHaveBeenCalled();
    const gate = getFrameworkGate();
    expect(gate?.phase).toBe("prompt");
    expect(gate?.below).toEqual([
      { name: "@facilis.dev/core", pinned: "0.0.0", minimum: CORE_MINIMUM },
    ]);
  });
});

describe("the update action", () => {
  it("applies the recipe, runs npm install, then boots; the marker keeps its version", async () => {
    const { bridge, files, posts } = fakeBridge();
    files.set(PKG, BELOW);
    files.set(MARKER, renderAppManifest("0.1.9"));
    const start = vi.fn();
    await frameworkRunGate(bridge, ROOT, start);
    await acceptFrameworkUpdate();
    const pkg = JSON.parse(files.get(PKG) as string) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@facilis.dev/core"]).toBe(CORE_MINIMUM);
    expect(pkg.dependencies.react).toBe("19.3.0");
    // The install postflight ran through the kernel's spawn channel before the boot.
    const spawn = posts.find((p) => p.type === "proc-spawn");
    expect(spawn?.extra).toMatchObject({ command: "npm", args: ["install"], cwd: ROOT });
    // Marker last, and the environment version is the project's own, not the recipe key.
    expect(parseAppManifest(files.get(MARKER) as string)?.environmentVersion).toBe("0.1.9");
    expect(start).toHaveBeenCalledTimes(1);
    expect(getFrameworkGate()).toBeNull();
  });

  it("adopts the build's environment version for a marker-less project", async () => {
    const { bridge, files } = fakeBridge();
    files.set(PKG, BELOW);
    const start = vi.fn();
    await frameworkRunGate(bridge, ROOT, start);
    await acceptFrameworkUpdate();
    expect(parseAppManifest(files.get(MARKER) as string)?.environmentVersion).toBe(
      environmentVersion,
    );
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("keeps the project unbooted and rolls back when the install fails", async () => {
    const { bridge, files } = fakeBridge(1);
    files.set(PKG, BELOW);
    files.set(MARKER, renderAppManifest("0.1.9"));
    const start = vi.fn();
    await frameworkRunGate(bridge, ROOT, start);
    await acceptFrameworkUpdate();
    const gate = getFrameworkGate();
    expect(gate?.phase).toBe("error");
    expect(gate?.error).toBeTruthy();
    expect(start).not.toHaveBeenCalled();
    // Rollback restored the original package.json; the marker never moved.
    expect(files.get(PKG)).toBe(BELOW);
    expect(parseAppManifest(files.get(MARKER) as string)?.environmentVersion).toBe("0.1.9");
  });

  it("decline refuses to boot with a localized message", async () => {
    const { bridge, files } = fakeBridge();
    files.set(PKG, BELOW);
    const start = vi.fn();
    await frameworkRunGate(bridge, ROOT, start);
    declineFrameworkUpdate();
    expect(getFrameworkGate()).toBeNull();
    expect(start).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
