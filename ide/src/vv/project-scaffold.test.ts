import { describe, expect, it, vi } from "vitest";
import type { KernelBridge } from "./kernel";
import type { ProjectImportHost } from "./project-import";
import type { ProjectTemplate } from "./project-manifest";
import { scaffoldFacilisProject } from "./project-scaffold";

const template: ProjectTemplate = {
  manifest: {
    id: "facilis",
    name: "facilis",
    port: 3000,
    entry: "src/App.tsx",
    install: "npm install",
    dev: "npm run dev",
    hmr: true,
    reload: false,
  },
  files: {
    "package.json": "{}",
    "facilis.app.json": "{}",
    "src/App.tsx": "app",
    "README.md": "# template",
  },
};

function fakeBridge(existing: string[]) {
  const calls: { type: string; payload: unknown }[] = [];
  const request = vi.fn(async (type: string, payload: unknown) => {
    calls.push({ type, payload });
    if (type === "vv-read-tree") {
      return { ok: true, files: existing.map((path) => ({ path, bytes: new Uint8Array() })) };
    }
    return { ok: true };
  });
  const post = vi.fn();
  return { bridge: { request, post } as unknown as KernelBridge, calls, post };
}

function fakeHost(ready = true): ProjectImportHost {
  return {
    kernelReady: () => ready,
    set: vi.fn(),
    slug: (name: string) => name,
    defaultDirFor: (name: string) => "/w/" + name,
    validateNewDir: async () => null,
    openFolder: vi.fn(),
    openFile: vi.fn(),
    registerProjectMeta: vi.fn(),
    registerManifest: vi.fn(),
    status: vi.fn(),
  };
}

describe("scaffoldFacilisProject", () => {
  it("writes the template and keeps files the repository already had", async () => {
    const { bridge, calls, post } = fakeBridge(["README.md"]);
    const host = fakeHost();
    expect(await scaffoldFacilisProject(bridge, host, "/w/empty", async () => template)).toBe(true);
    const importCall = calls.find((call) => call.type === "vv-import-tree");
    const payload = (importCall?.payload as { dir: string; files: { path: string }[] } | undefined)
      ?.files;
    expect(payload?.map((file) => file.path).sort()).toEqual([
      "facilis.app.json",
      "package.json",
      "src/App.tsx",
    ]);
    expect(host.registerManifest).toHaveBeenCalledWith("/w/empty", template.manifest);
    expect(post).toHaveBeenCalledWith(
      "vv-register-project",
      expect.objectContaining({ dir: "/w/empty" }),
    );
    expect(host.openFile).toHaveBeenCalledWith("/w/empty/src/App.tsx");
  });

  it("refuses a folder that already contains a project", async () => {
    const { bridge, calls } = fakeBridge(["package.json"]);
    expect(await scaffoldFacilisProject(bridge, fakeHost(), "/w/app", async () => template)).toBe(
      false,
    );
    expect(calls.some((call) => call.type === "vv-import-tree")).toBe(false);
  });

  it("refuses before the runtime is ready", async () => {
    const { bridge } = fakeBridge([]);
    expect(
      await scaffoldFacilisProject(bridge, fakeHost(false), "/w/app", async () => template),
    ).toBe(false);
  });
});
