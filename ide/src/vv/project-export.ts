// Project export and sharing: read a project's whole source tree over the
// kernel, zip it to disk, or encode it into a self-contained #share= link.
// Split out of controller.ts (D-019/D-042); the controller keeps the
// active-folder commands and the shared-link boot glue.

import { toast } from "sonner";
import { createZip, encodeShare } from "../../../vendor/vivari/packages/kernel-host/archive.js";
import { errText } from "./errors";
import type { FileTree } from "./file-tree";
import type { KernelBridge } from "./kernel";
import { baseName, normDir } from "./path-utils";

// Practical cap on a shareable-URL length; beyond this the link is unwieldy.
const MAX_SHARE_URL_LEN = 1_800_000;

// Download an in-memory Blob to the user's disk (zip export).
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** What export/share needs from the controller. */
export interface ProjectExportHost {
  status(text: string): void;
}

export class ProjectExport {
  private readonly bridge: KernelBridge;
  private readonly host: ProjectExportHost;

  constructor(bridge: KernelBridge, host: ProjectExportHost) {
    this.bridge = bridge;
    this.host = host;
  }

  async readProjectTree(rootPath: string): Promise<{ files: FileTree; truncated: boolean }> {
    const m = await this.bridge.request("vv-read-tree", { root: normDir(rootPath) });
    if (!m.ok) return { files: [], truncated: false };
    const files = ((m.files as FileTree) ?? []).filter((f) => f.bytes instanceof Uint8Array);
    return { files, truncated: !!m.truncated };
  }

  // Export a project as a .zip downloaded to disk.
  async exportProjectZip(rootPath: string) {
    const root = normDir(rootPath);
    const { files, truncated } = await this.readProjectTree(root);
    if (!files.length) {
      toast.error("Nothing to export in this project.");
      return;
    }
    try {
      const zip = await createZip(files);
      const filename = (baseName(root) || "project") + ".zip";
      downloadBlob(new Blob([zip as BlobPart], { type: "application/zip" }), filename);
      const count = `${files.length} file${files.length === 1 ? "" : "s"}`;
      toast.success(`Exported ${filename}`, {
        description: `${count} · node_modules excluded`,
      });
      this.host.status(`exported ${count} → ${filename}`);
      if (truncated) toast.warning("Project was large — the export was truncated.");
    } catch (err) {
      toast.error("Export failed: " + errText(err));
    }
  }

  // Build a self-contained shareable URL (compressed project source in the hash)
  // and copy it to the clipboard. Source-only (node_modules excluded); capped so
  // the link stays usable. Returns the URL, or null if it can't be shared.
  async shareProject(rootPath: string): Promise<string | null> {
    const root = normDir(rootPath);
    const { files, truncated } = await this.readProjectTree(root);
    if (!files.length) {
      toast.error("Nothing to share in this project.");
      return null;
    }
    if (truncated) {
      toast.error("Project is too large to share as a link.");
      return null;
    }
    try {
      const payload = await encodeShare({ name: baseName(root) || "project", files });
      const url = location.origin + location.pathname + "#share=" + payload;
      if (url.length > MAX_SHARE_URL_LEN) {
        toast.error("Project is too big to share as a link.");
        return null;
      }
      const kb = Math.max(1, Math.round(url.length / 1024));
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Share link copied to clipboard.", {
          description: `Self-contained · source only · ${kb} KB`,
          position: "bottom-left",
        });
        this.host.status(`share link copied (${kb} KB)`);
      } catch {
        toast.warning("Couldn't copy to clipboard — copy the link from the address bar.", {
          position: "bottom-left",
        });
        this.host.status("share link ready");
      }
      return url;
    } catch (err) {
      toast.error("Share failed: " + errText(err));
      return null;
    }
  }
}
