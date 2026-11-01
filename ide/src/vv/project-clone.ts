// Cloning a repository with real git over the IDE's stateless proxy (D-079).
//
// This is the import half of real git: unlike the REST importer (D-073/D-074) the
// clone keeps .git, so history, branches and the Source Control panel work on the
// project immediately. It needs the proxy because the hosts send no CORS headers on
// their git endpoints; when the deployment has none, the caller falls back to the
// REST importer (or offers nothing, in a managed build).
//
// Split from project-import.ts so each file stays under the 300-line limit; the
// controller-facing flow (new project dir, manifest, open) mirrors importFilesAsProject.

import { toast } from "sonner";
import type { ProjectImportHost } from "./project-import";
import { synthesizeManifest } from "./project-import";
import { errText } from "./errors";
import type { FileTree } from "./file-tree";
import { createGitFs } from "./git-fs";
import { cloneRepo, probeProxy, proxyBase, type Credentials } from "./git-remote";
import type { KernelBridge } from "./kernel";
import { normDir } from "./path-utils";
import { projectName } from "./project-name";

export interface CloneOptions {
  /** Token for a private repository: per clone, never stored (D-073's rule). */
  credentials?: Credentials;
  /** Git's own phases ("Receiving objects", "Resolving deltas", …). */
  onProgress?: (phase: string, loaded: number, total: number) => void;
}

/** Whether this deployment can clone with real git (proxy configured AND answering). */
export async function gitAvailable(): Promise<boolean> {
  const base = proxyBase();
  return base !== null && (await probeProxy(base));
}

async function freeDirFor(name: string, host: ProjectImportHost): Promise<string> {
  const base = host.slug(name);
  let dir = host.defaultDirFor(base);
  let n = 2;
  while (await host.validateNewDir(dir)) {
    dir = host.defaultDirFor(base + "-" + n++);
    if (n > 50) break;
  }
  return dir;
}

/**
 * Clone `url` into a new project and open it. Returns false when the deployment has
 * no working proxy: that is a "not available here", not a failure, so the dialog can
 * fall back to the REST import without a scary toast.
 */
export async function cloneIntoProject(
  bridge: KernelBridge,
  host: ProjectImportHost,
  url: string,
  opts: CloneOptions = {},
): Promise<boolean> {
  if (!host.kernelReady()) {
    toast.error("Kernel is still starting — try again in a moment.");
    return false;
  }
  if (!(await gitAvailable())) return false;

  const name = projectName(url);
  const root = await freeDirFor(name, host);
  await bridge.request("vv-mkdirp", { path: root });
  try {
    await cloneRepo({
      fs: createGitFs(bridge),
      dir: normDir(root),
      url,
      credentials: opts.credentials,
      onProgress: opts.onProgress,
    });
  } catch (err) {
    toast.error("Clone failed: " + errText(err));
    return false;
  }

  // Read the cloned tree through the kernel (same bulk read export uses) so the run
  // manifest can be synthesized without a second git walk.
  const m = await bridge.request("vv-read-tree", { root: normDir(root) });
  const files = m.ok ? ((m.files as FileTree) ?? []) : [];
  const manifest = synthesizeManifest(files, name);
  if (manifest !== null) {
    host.registerManifest(root, manifest);
    bridge.post("vv-register-project", { dir: root, manifest, title: name });
  }
  host.registerProjectMeta({ rootPath: root, template: null });
  host.openFolder(root);
  const openTarget =
    manifest?.entry || files.find((f) => f.path === "package.json")?.path || files[0]?.path;
  if (openTarget) void host.openFile(root + "/" + openTarget);
  host.status("cloned " + name);
  toast.success("Cloned " + name, {
    description: files.length + " files — full git history in .git",
  });
  return true;
}
