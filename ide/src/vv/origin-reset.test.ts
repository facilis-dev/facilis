import { describe, expect, it } from "vitest";
import { resetOriginState, type OriginResetTargets } from "./origin-reset";

// "Reset everything" used to wipe OPFS and the recent-projects registry only. A Service
// Worker is not part of a browser's "cached files" and stays registered until it is
// unregistered, so the next load could still be served by the previous build's worker.
// These cases pin that the reset owns the VFS, every registration and CacheStorage.
function recorder(): { calls: string[]; targets: Required<OriginResetTargets> } {
  const calls: string[] = [];
  return {
    calls,
    targets: {
      wipeVfs: async () => void calls.push("vfs"),
      registrations: async () => [
        {
          unregister: async () => {
            calls.push("unregister:1");
            return true;
          },
        },
        {
          unregister: async () => {
            calls.push("unregister:2");
            return true;
          },
        },
      ],
      cacheKeys: async () => {
        calls.push("cache:keys");
        return ["vv-config", "vv-precache-abc"];
      },
      deleteCache: async (key) => {
        calls.push("cache:delete:" + key);
        return true;
      },
    },
  };
}

describe("reset origin state", () => {
  it("wipes the VFS, unregisters every worker and drops every cache", async () => {
    const { calls, targets } = recorder();
    await resetOriginState(targets);
    expect(calls).toContain("vfs");
    expect(calls).toContain("unregister:1");
    expect(calls).toContain("unregister:2");
    expect(calls).toContain("cache:delete:vv-config");
    expect(calls).toContain("cache:delete:vv-precache-abc");
  });

  it("cleans the other targets when one of them fails", async () => {
    const { calls, targets } = recorder();
    targets.wipeVfs = async () => {
      calls.push("vfs");
      throw new Error("OPFS busy");
    };
    targets.registrations = async () => {
      throw new Error("no navigator");
    };
    await expect(resetOriginState(targets)).resolves.toBeUndefined();
    expect(calls).toContain("vfs");
    expect(calls).toContain("cache:delete:vv-config");
  });

  it("resolves when the browser APIs are missing", async () => {
    await expect(resetOriginState({ wipeVfs: async () => undefined })).resolves.toBeUndefined();
  });
});
