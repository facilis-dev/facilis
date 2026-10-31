// Deleting a project for good: its files, then its registry entry.
//
// Split out of controller.ts (whose size the file-length ratchet pins). The hard part is
// not the rm: a project's subtree is normally still deferred in the OPFS mirror (D-036), so
// the tree has to be hydrated first — a bare recursive rm would find nothing in this tab's
// VFS and leave every file on OPFS, which is exactly the old "remove from list" bug in a new
// place (D-050).
import { toast } from "sonner";
import { t } from "@/i18n";
import { normDir } from "./path-utils";
import { claimProject } from "./project-lock";
import { projectName } from "./project-name";

/** What deleting one project needs from the controller. */
export interface ProjectDeleteHost {
  isOpen(rootPath: string): boolean;
  closeOpen(rootPath: string): void;
  stopProject(rootPath: string): void;
  /** Replay the project's deferred OPFS subtree into the VFS; false when it is gone. */
  hydrateProject(rootPath: string): Promise<boolean>;
  /** Recursive rm; rejects when the kernel refuses. */
  removeTree(rootPath: string): Promise<void>;
  forgetProject(rootPath: string): void;
  status(text: string): void;
}

/**
 * Delete `rootPath` from this origin. Returns false (and toasts) when another live tab has
 * claimed the project or the kernel refuses the rm; the registry entry is only dropped once
 * the files are gone.
 */
export async function deleteProject(host: ProjectDeleteHost, rootPath: string): Promise<boolean> {
  const root = normDir(rootPath);
  const name = projectName(root);
  const open = host.isOpen(root);
  // The same Web Lock the tab bootstrap uses: a tab that holds the project keeps the tree in
  // RAM and its write-behind mirror would recreate what was just deleted. A folder open in
  // THIS tab is already this tab's claim.
  const claim = open ? null : await claimProject(root);
  if (!open && !claim) {
    toast.error(t("project.openElsewhere", { name }));
    return false;
  }
  try {
    if (open) host.closeOpen(root);
    host.stopProject(root);
    if (await host.hydrateProject(root)) await host.removeTree(root);
    host.forgetProject(root);
    host.status(t("project.deleted", { name }));
    return true;
  } catch (err) {
    toast.error(
      t("project.deleteFailed", {
        name,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return false;
  } finally {
    claim?.release();
  }
}
