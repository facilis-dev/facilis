import { describe, expect, it } from "vitest";
import type { PatchBridge } from "@/facilis/apply-patch";
import {
  INSTRUCTIONS_PATH,
  INSTRUCTIONS_TEMPLATE,
  ensureInstructions,
  openProjectInstructions,
} from "./instructions";

function fakeHost(options: { existing?: string; fail?: boolean } = {}) {
  const calls: string[] = [];
  const opened: string[] = [];
  const bridge: PatchBridge = {
    async request(type, extra) {
      calls.push(type + ":" + String(extra?.path ?? ""));
      if (options.fail) throw new Error("kernel refused");
      return { ok: true };
    },
  };
  return {
    calls,
    opened,
    host: {
      bridge,
      root: () => "/home/user/project",
      read: async () => options.existing ?? "",
      openFile: (path: string) => {
        opened.push(path);
      },
    },
  };
}

describe("project instructions", () => {
  it("creates AGENTS.md from the template when the project has none", async () => {
    const harness = fakeHost();
    expect(
      await ensureInstructions({
        bridge: harness.host.bridge,
        root: "/home/user/project",
        read: harness.host.read,
      }),
    ).toEqual([]);
    expect(harness.calls).toEqual(["vv-write:/home/user/project/" + INSTRUCTIONS_PATH]);
  });

  it("does not overwrite an existing AGENTS.md", async () => {
    const harness = fakeHost({ existing: "# ours\n" });
    expect(
      await ensureInstructions({
        bridge: harness.host.bridge,
        root: "/home/user/project",
        read: harness.host.read,
      }),
    ).toEqual([]);
    expect(harness.calls).toEqual([]);
  });

  it("reports a refused write instead of opening the file", async () => {
    const harness = fakeHost({ fail: true });
    const error = await openProjectInstructions(harness.host);
    expect(error).toBe(INSTRUCTIONS_PATH + ": kernel refused");
    expect(harness.opened).toEqual([]);
  });

  it("opens the file after ensuring it", async () => {
    const harness = fakeHost();
    expect(await openProjectInstructions(harness.host)).toBeNull();
    expect(harness.opened).toEqual([INSTRUCTIONS_PATH]);
  });

  it("ships a template that states the precedence", () => {
    expect(INSTRUCTIONS_TEMPLATE).toContain("# Agent instructions");
    expect(INSTRUCTIONS_TEMPLATE).toContain("cannot disable");
  });
});
