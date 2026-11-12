import { describe, expect, it } from "vitest";
import type { PatchBridge } from "./apply-patch";
import { writeProjectAsset } from "./vfs-write";

interface Call {
  type: string;
  extra: Record<string, unknown>;
}

function recordingBridge(calls: Call[]): PatchBridge {
  return {
    async request(type, extra) {
      calls.push({ type, extra: extra ?? {} });
      return {};
    },
  };
}

describe("writeProjectAsset", () => {
  it("creates the parent directory, then writes the bytes at the absolute path", async () => {
    const calls: Call[] = [];
    const bytes = new Uint8Array([1, 2, 3]);
    await writeProjectAsset({
      bridge: recordingBridge(calls),
      root: "/workspace/app",
      path: "public/logo.png",
      bytes,
    });
    expect(calls).toEqual([
      { type: "vv-mkdirp", extra: { path: "/workspace/app/public" } },
      { type: "vv-write", extra: { path: "/workspace/app/public/logo.png", bytes } },
    ]);
  });

  it("normalizes slashes on both sides of the join", async () => {
    const calls: Call[] = [];
    await writeProjectAsset({
      bridge: recordingBridge(calls),
      root: "/workspace/app/",
      path: "/public/a.txt",
      bytes: new Uint8Array(0),
    });
    expect(calls.map((call) => call.extra.path)).toEqual([
      "/workspace/app/public",
      "/workspace/app/public/a.txt",
    ]);
  });

  it("mkdirps the project root itself when the file sits at the root (idempotent)", async () => {
    const calls: Call[] = [];
    await writeProjectAsset({
      bridge: recordingBridge(calls),
      root: "/workspace/app",
      path: "logo.png",
      bytes: new Uint8Array(0),
    });
    expect(calls.map((call) => [call.type, call.extra.path])).toEqual([
      ["vv-mkdirp", "/workspace/app"],
      ["vv-write", "/workspace/app/logo.png"],
    ]);
  });

  it("propagates a bridge failure instead of reporting a partial write", async () => {
    const bridge: PatchBridge = {
      async request() {
        throw new Error("kernel unavailable");
      },
    };
    await expect(
      writeProjectAsset({
        bridge,
        root: "/workspace/app",
        path: "public/a.txt",
        bytes: new Uint8Array(0),
      }),
    ).rejects.toThrow("kernel unavailable");
  });
});
