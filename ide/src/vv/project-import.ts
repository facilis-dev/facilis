// Importing a project into the VM: a local folder/drop, a GitHub repo or an npm
// package, all landing as a new project (plus the manifest synthesis that lets
// Run install and start it). Split out of controller.ts (D-019/D-042); the
// controller keeps project dirs/validation, the workspace and the share-link
// boot glue.

import { toast } from "sonner";
import { decodeShare } from "../../../vendor/vivari/packages/kernel-host/archive.js";
import { type FileTree, treeFromDrop, treeFromFileList } from "./file-tree";
import {
  fetchGithubRepo,
  fetchNpmPackage,
  parseGithubSpec,
  parseNpmSpec,
  type ProgressFn,
} from "./import-remote";
import type { KernelBridge } from "./kernel";
import { normDir } from "./path-utils";
import { projectName } from "./project-name";
import type { TemplateManifest } from "./templates";

/** What the importers need from the controller. */
export interface ProjectImportHost {
  kernelReady(): boolean;
  set(patch: { importRemoteOpen?: boolean }): void;
  slug(name: string): string;
  defaultDirFor(name: string): string;
  validateNewDir(dir: string): Promise<string | null>;
  openFolder(rootPath: string): void;
  openFile(abs: string): void;
  registerProjectMeta(meta: { rootPath: string; template: string | null }): void;
  registerManifest(rootPath: string, manifest: TemplateManifest): void;
  status(text: string): void;
}

/** Synthesize a run manifest for an imported/shared project from its
 *  package.json (so Run auto-installs + starts a dev server). Null when there
 *  is no runnable script — the project still opens; Run drops into a shell. */
export function synthesizeManifest(files: FileTree, name: string): TemplateManifest | null {
  const pkgFile = files.find((f) => f.path === "package.json");
  if (!pkgFile) return null;
  let pkg: {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(new TextDecoder().decode(pkgFile.bytes));
  } catch {
    return null;
  }
  const scripts = pkg.scripts || {};
  const devKey = scripts.dev ? "dev" : scripts.start ? "start" : scripts.serve ? "serve" : null;
  if (!devKey) return null;
  const dev = devKey === "start" ? "npm start" : `npm run ${devKey}`;
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const usesVite = "vite" in allDeps || /vite/.test(scripts[devKey] || "");
  const hasTs = files.some((f) => /\.tsx?$/.test(f.path)) || "typescript" in allDeps;
  const entryCandidates = [
    "src/App.tsx",
    "src/App.jsx",
    "src/main.tsx",
    "src/main.ts",
    "src/index.tsx",
    "src/index.ts",
    "src/index.js",
    "index.ts",
    "index.js",
    "README.md",
  ];
  const entry =
    entryCandidates.find((c) => files.some((f) => f.path === c)) ||
    files[0]?.path ||
    "package.json";
  return {
    id: "imported",
    framework: "node",
    icon: "package",
    category: "Frontend",
    name,
    language: hasTs ? "TypeScript" : "JavaScript",
    description: "Imported project",
    port: usesVite ? 5173 : 3000,
    openPath: "/",
    entry,
    hmr: usesVite,
    reload: !usesVite,
    install: "npm install",
    dev,
  };
}

export class ProjectImport {
  private readonly bridge: KernelBridge;
  private readonly host: ProjectImportHost;

  constructor(bridge: KernelBridge, host: ProjectImportHost) {
    this.bridge = bridge;
    this.host = host;
  }

  // Synthesize a run manifest for an imported/shared project from its package.json
  // (so Run auto-installs + starts a dev server). Null when there's no runnable
  // script — the project still opens; Run just drops into a shell.
  // Create a NEW project from an in-memory file tree (folder import / shared URL).
  async importFilesAsProject({
    dir,
    files,
    excludedNodeModules,
    silent,
  }: {
    dir: string;
    files: FileTree;
    excludedNodeModules?: boolean;
    silent?: boolean;
  }): Promise<boolean> {
    if (!this.host.kernelReady()) {
      toast.error("Kernel is still starting — try again in a moment.");
      return false;
    }
    if (!files.length) {
      toast.error("No files to import.");
      return false;
    }
    const root = normDir(dir);
    const err = await this.host.validateNewDir(root);
    if (err) {
      toast.error(err);
      return false;
    }
    const res = await this.bridge.request("vv-import-tree", { dir: root, files });
    if (!res.ok) {
      toast.error(`Import failed: ${res.error ?? "unknown error"}`);
      return false;
    }
    const name = projectName(root);
    const manifest = synthesizeManifest(files, name);
    if (manifest) {
      this.host.registerManifest(root, manifest);
      this.bridge.post("vv-register-project", { dir: root, manifest, title: name });
    }
    this.host.registerProjectMeta({ rootPath: root, template: null });
    this.host.openFolder(root);
    const openTarget =
      manifest?.entry || files.find((f) => f.path === "package.json")?.path || files[0]?.path;
    if (openTarget) void this.host.openFile(root + "/" + openTarget);
    const note = excludedNodeModules ? " (node_modules excluded)" : "";
    const count = `${files.length} file${files.length === 1 ? "" : "s"}`;
    this.host.status(`imported ${count} as ${name}${note}`);
    if (!silent) {
      toast.success(`Imported ${name} — ${count}${note}`, {
        description: excludedNodeModules ? "Run the project to reinstall dependencies." : undefined,
      });
    }
    return true;
  }

  // A default project dir for `name` that doesn't collide with an open/known one.
  private async freeDirFor(name: string): Promise<string> {
    const base = this.host.slug(name);
    let dir = this.host.defaultDirFor(base);
    let n = 2;
    while (await this.host.validateNewDir(dir)) {
      dir = this.host.defaultDirFor(base + "-" + n++);
      if (n > 50) break;
    }
    return dir;
  }

  // Open the OS folder picker and import the chosen directory as a new project.
  importFolderViaPicker() {
    if (!this.host.kernelReady()) {
      toast.error("Kernel is still starting — try again in a moment.");
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.onchange = async () => {
      const list = input.files;
      if (!list || !list.length) return;
      const { name, files, excludedNodeModules } = await treeFromFileList(list);
      if (!files.length) {
        toast.error("No importable files in that folder.");
        return;
      }
      const dir = await this.freeDirFor(name);
      await this.importFilesAsProject({ dir, files, excludedNodeModules });
    };
    input.click();
  }

  // Import an OS drop (folder / files) as a new project (Home dropzone).
  async importDropAsProject(entries: FileSystemEntry[]) {
    if (!this.host.kernelReady()) {
      toast.error("Kernel is still starting — try again in a moment.");
      return;
    }
    if (!entries.length) return;
    const { name, files, excludedNodeModules } = await treeFromDrop(entries);
    if (!files.length) {
      toast.error("No importable files were dropped.");
      return;
    }
    const dir = await this.freeDirFor(name);
    await this.importFilesAsProject({ dir, files, excludedNodeModules });
  }

  // ── Import from a remote source (GitHub repo / npm package) ────────────────
  openImportRemote() {
    if (!this.host.kernelReady()) {
      toast.error("Kernel is still starting — try again in a moment.");
      return;
    }
    this.host.set({ importRemoteOpen: true });
  }
  closeImportRemote() {
    this.host.set({ importRemoteOpen: false });
  }

  // Fetch a remote tree, then land it as a new project. Shared spine for the
  // GitHub/npm importers: both just supply a fetcher. Returns true on success so
  // the dialog can close itself. Progress flows to the dialog via onProgress.
  private async importRemoteTree(
    fetchTree: () => Promise<{
      name: string;
      files: FileTree;
      excludedNodeModules: boolean;
      truncated?: boolean;
    }>,
  ): Promise<boolean> {
    if (!this.host.kernelReady()) {
      toast.error("Kernel is still starting — try again in a moment.");
      return false;
    }
    const { name, files, excludedNodeModules, truncated } = await fetchTree();
    if (!files.length) {
      toast.error("Nothing to import.");
      return false;
    }
    const dir = await this.freeDirFor(name);
    const ok = await this.importFilesAsProject({ dir, files, excludedNodeModules });
    if (ok && truncated) {
      toast.warning("Project was large — some files were skipped past the import limit.", {
        position: "bottom-left",
      });
    }
    return ok;
  }

  // Import a public GitHub repo. `input` is a URL or `owner/repo[@ref]` shorthand.
  async importGithubRepo(input: string, onProgress?: ProgressFn): Promise<boolean> {
    const spec = parseGithubSpec(input);
    if (!spec) {
      toast.error("Enter a GitHub repo, e.g. owner/repo or a github.com URL.");
      return false;
    }
    return this.importRemoteTree(() => fetchGithubRepo(spec, onProgress));
  }

  // Import an npm package. `input` is `name`, `name@version`, or `name@tag`.
  async importNpmPackage(input: string, onProgress?: ProgressFn): Promise<boolean> {
    const spec = parseNpmSpec(input);
    if (!spec) {
      toast.error("Enter an npm package name, e.g. left-pad or @scope/pkg@1.2.3.");
      return false;
    }
    return this.importRemoteTree(() => fetchNpmPackage(spec, onProgress));
  }

  /** Land a decoded #share= payload as a new project (boot-time import). */
  async importShared(payload: string): Promise<{ ok: boolean; dir: string; files: number }> {
    const { name, files } = await decodeShare(payload);
    const dir = await this.freeDirFor(name);
    const ok = await this.importFilesAsProject({ dir, files, silent: true });
    return { ok, dir, files: files.length };
  }
}
