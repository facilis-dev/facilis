// Populating an empty repository with the Facilis project (D-080).
//
// An empty (or README-only) remote is the common "start from scratch on GitHub" case:
// the clone has .git and a remote but no project, so the IDE offers the one template it
// ships. Scaffolding writes the template into the existing folder without deleting or
// overwriting anything (a README the repository already had stays), registers the run
// manifest, and leaves the commit and the push to Source Control — the user reviews the
// files before they become history.

import { toast } from "sonner";
import { t } from "@/i18n";
import { withTemplateAssets } from "../facilis/project-assets";
import { loadFacilisTemplate } from "../facilis/template-loader";
import type { FileTree } from "./file-tree";
import type { KernelBridge } from "./kernel";
import { normDir } from "./path-utils";
import type { ProjectImportHost } from "./project-import";
import type { ProjectTemplate } from "./project-manifest";
import { projectName } from "./project-name";

/** Injected in tests; production reads the template's lazy chunk. */
export type TemplateLoader = () => Promise<ProjectTemplate>;

const encoder = new TextEncoder();

async function existingPaths(bridge: KernelBridge, root: string): Promise<Set<string>> {
  const res = await bridge.request("vv-read-tree", { root });
  const files = res.ok ? ((res.files as FileTree) ?? []) : [];
  return new Set(files.map((file) => file.path));
}

/**
 * Write the Facilis template into `root` and register it as that folder's project.
 * Returns false, with a toast, when the folder already holds a project. Never deletes
 * a file: paths that already exist are kept as they are.
 */
export async function scaffoldFacilisProject(
  bridge: KernelBridge,
  host: ProjectImportHost,
  root: string,
  loadTemplate: TemplateLoader = loadFacilisTemplate,
): Promise<boolean> {
  if (!host.kernelReady()) {
    toast.error(t("scaffold.kernelStarting"));
    return false;
  }
  const dir = normDir(root);
  const existing = await existingPaths(bridge, dir);
  if (existing.has("package.json")) {
    toast.error(t("scaffold.alreadyProject"));
    return false;
  }

  const template = await loadTemplate();
  const files = await withTemplateAssets(template, template.files);
  const payload = Object.entries(files)
    .filter(([path]) => !existing.has(path))
    .map(([path, content]) => ({
      path,
      bytes: typeof content === "string" ? encoder.encode(content) : content,
    }));
  if (payload.length === 0) {
    toast.error(t("scaffold.alreadyProject"));
    return false;
  }

  const res = await bridge.request("vv-import-tree", { dir, files: payload });
  if (!res.ok) {
    toast.error(t("scaffold.failed", { error: String(res.error ?? "unknown error") }));
    return false;
  }

  host.registerManifest(dir, template.manifest);
  bridge.post("vv-register-project", { dir, manifest: template.manifest, title: projectName(dir) });
  host.registerProjectMeta({ rootPath: dir, template: template.manifest.id });
  host.openFolder(dir);
  host.openProjectGraph();
  host.status(t("scaffold.status"));
  toast.success(t("scaffold.doneTitle"), { description: t("scaffold.doneDescription") });
  return true;
}
