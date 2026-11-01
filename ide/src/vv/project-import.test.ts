import { describe, expect, it, vi } from "vitest";
import { openDeployment, resolveDeployment } from "@/deploy/resolve";
import type { FileTree } from "./file-tree";
import type { KernelBridge } from "./kernel";
import { ProjectImport, synthesizeManifest, type ProjectImportHost } from "./project-import";

const utf8 = (text: string) => new TextEncoder().encode(text);
const tree = (pkg: unknown, extra: string[] = []): FileTree => [
  { path: "package.json", bytes: utf8(JSON.stringify(pkg)) },
  ...extra.map((path) => ({ path, bytes: utf8("") })),
];

function managed() {
  return resolveDeployment({
    profile: "managed",
    company: { name: "Acme", domain: "facilis.acme.example" },
    packages: { registry: "https://npm.acme.example" },
    projects: { preview: { origin: "https://preview.facilis.acme.example" } },
  });
}

function host(): ProjectImportHost {
  return {
    kernelReady: vi.fn(() => true),
    set: vi.fn(),
    slug: vi.fn(() => "app"),
    defaultDirFor: vi.fn(() => "/home/user/projects/app"),
    validateNewDir: vi.fn(async () => null),
    openFolder: vi.fn(),
    openFile: vi.fn(),
    registerProjectMeta: vi.fn(),
    registerManifest: vi.fn(),
    status: vi.fn(),
  };
}

// The guard runs before any kernel message, so a structurally empty stand-in is
// enough; constructing a real bridge would boot a worker for a policy test.
const bridge = {} as unknown as KernelBridge;

describe("import guard", () => {
  it("allows every path in an open build", () => {
    const h = host();
    const importer = new ProjectImport(bridge, h, openDeployment());
    expect(importer.openImportRemote()).toBe(true);
    expect(h.set).toHaveBeenCalledWith({ importRemoteOpen: true });
  });

  it("refuses every compiled-out import before any side effect", async () => {
    const h = host();
    const importer = new ProjectImport(bridge, h, managed());
    expect(importer.importFolderViaPicker()).toBe(false);
    await expect(importer.importDropAsProject([])).resolves.toBe(false);
    expect(importer.openImportRemote()).toBe(false);
    await expect(importer.importGitRepo("owner/repo")).resolves.toBe(false);
    // The refusal happens first: no kernel check, no dialog, no picker, no fetch.
    expect(h.kernelReady).not.toHaveBeenCalled();
    expect(h.set).not.toHaveBeenCalled();
    expect(h.status).not.toHaveBeenCalled();
  });

  it("blocks only the kind a profile removed", () => {
    const importer = new ProjectImport(
      bridge,
      host(),
      resolveDeployment({ projects: { imports: { folder: false } } }),
    );
    expect(importer.importFolderViaPicker()).toBe(false);
    // Git import is still allowed, so Home keeps its repository card.
    expect(importer.openImportRemote()).toBe(true);
  });
});

describe("synthesizeManifest", () => {
  it("returns null without a package.json or without a runnable script", () => {
    expect(synthesizeManifest([], "app")).toBeNull();
    expect(synthesizeManifest(tree({ name: "x" }), "app")).toBeNull();
    expect(synthesizeManifest(tree({ scripts: { test: "vitest" } }), "app")).toBeNull();
  });

  it("turns a vite dev script into an HMR manifest on 5173", () => {
    const m = synthesizeManifest(
      tree({ scripts: { dev: "vite" }, dependencies: { vite: "^7.1.0" } }, ["src/App.tsx"]),
      "app",
    );
    expect(m).toMatchObject({
      id: "imported",
      name: "app",
      dev: "npm run dev",
      port: 5173,
      hmr: true,
      reload: false,
      entry: "src/App.tsx",
      install: "npm install",
    });
  });

  it("uses the start script verbatim and a reload server when not vite", () => {
    const m = synthesizeManifest(
      tree({ scripts: { start: "node server.js" } }, ["index.js", "README.md"]),
      "api",
    );
    expect(m).toMatchObject({
      dev: "npm start",
      port: 3000,
      hmr: false,
      reload: true,
      entry: "index.js",
    });
  });
});
