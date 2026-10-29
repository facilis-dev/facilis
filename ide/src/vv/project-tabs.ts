// Browser tabs are the IDE's unit of work: one project per tab, several tabs open at
// once. The kernel already supports it (each tab boots its own VM, dev server and
// preview); what a tab needs from the Studio is a durable identity and a guard against
// sharing a project with another tab.
//
//   * Identity: the tab's URL always names the project it shows (?project=<rootPath>):
//     on boot that project is opened and run, so a reload lands back on it instead of
//     Home. A tab that started on Home stays parameterless until it opens something.
//   * Guard: every open folder is claimed with a Web Lock (see project-lock.ts). A
//     folder claimed by another live tab is closed again with a toast, because two RAM
//     copies of one project diverge and then mirror over each other.
import { toast } from "sonner";
import type { IdeController, IdeSnapshot } from "./controller";
import { claimProject, type ProjectClaim } from "./project-lock";
import { projectName } from "./project-name";

const TITLE_BASE = "Vivari Studio";

/** The URL a second tab should open to land on `rootPath` (keeps other boot params). */
export function projectTabUrl(rootPath: string): string {
  const url = new URL(location.href);
  url.hash = ""; // a #share= payload would bootstrap a clone instead of this project
  url.searchParams.set("project", rootPath);
  return url.toString();
}

/** Open `rootPath` in a new browser tab, alongside whatever this tab has open. */
export function openProjectInNewTab(rootPath: string): void {
  window.open(projectTabUrl(rootPath), "_blank", "noopener");
}

/**
 * Open the Studio itself in a new browser tab, landing on Home so another project can be
 * picked there. Other boot params (e.g. \`?net=\` for the network relay) are preserved;
 * only the tab's own \`project\` identity is dropped, or the new tab would claim the
 * project this one already holds.
 */
export function openStudioInNewTab(): void {
  const url = new URL(location.href);
  url.hash = "";
  url.searchParams.delete("project");
  window.open(url.toString(), "_blank", "noopener");
}

function projectParam(): string | null {
  return new URLSearchParams(location.search).get("project") || null;
}

export function installProjectTabs(controller: IdeController): () => void {
  const claims = new Map<string, ProjectClaim>();
  let bootstrapped = false;
  let disposed = false;
  // The ?project= identity is only dropped once this tab HAS a project and loses it. A
  // tab booting straight into ?project= has no folder open yet (Home is what shows while
  // the kernel boots), and pruning on that state deleted the parameter before the
  // bootstrap below could read it.
  let sawFolders = false;
  // Reconciles are serialized: a claim is async, and two overlapping passes would both
  // see an unclaimed folder and one of them would read the other's lock as a rival tab.
  let chain: Promise<void> = Promise.resolve();

  function updateTitle(snap: IdeSnapshot): void {
    const title = snap.projectTitle ? `${snap.projectTitle} — ${TITLE_BASE}` : TITLE_BASE;
    if (document.title !== title) document.title = title;
  }

  function dropProjectParam(): void {
    const url = new URL(location.href);
    if (!url.searchParams.has("project")) return;
    url.searchParams.delete("project");
    history.replaceState(history.state, "", url.toString());
  }

  function setProjectParam(rootPath: string): void {
    const url = new URL(location.href);
    if (url.searchParams.get("project") === rootPath) return;
    url.searchParams.set("project", rootPath);
    history.replaceState(history.state, "", url.toString());
  }

  // Keep the URL in step with the workspace, both ways: a tab that picks a project from
  // Home must survive a reload like one opened from another tab did (before, only the
  // latter carried the parameter, so F5 on a Home-picked project went back to Home), and
  // a tab that closes its last project goes back to being a plain Home tab.
  function syncProjectParam(snap: IdeSnapshot): void {
    if (snap.workspaceFolders.length === 0) {
      if (sawFolders) dropProjectParam();
      return;
    }
    sawFolders = true;
    const active = snap.workspaceFolders.find((folder) => folder.id === snap.activeFolderId);
    setProjectParam((active ?? snap.workspaceFolders[0]).rootPath);
  }

  async function bootstrapFromUrl(snap: IdeSnapshot): Promise<void> {
    if (bootstrapped) return;
    const root = projectParam();
    if (!root) return;
    if (!snap.kernelReady) return; // called again on the next snapshot change
    bootstrapped = true;
    const meta = snap.recentProjects.find((p) => p.rootPath === root);
    if (!meta) {
      toast.error("This tab's project is not in the recent-projects list any more.");
      dropProjectParam();
      return;
    }
    if (claims.has(root)) return;
    const claim = await claimProject(root);
    if (!claim) {
      toast.error(
        `${projectName(meta.rootPath)} is already open in another tab — close it there first.`,
      );
      dropProjectParam(); // this tab stays a plain Home tab; no retry loop on reload
      return;
    }
    claims.set(root, claim);
    await controller.openProject(meta);
    controller.runProject(root);
  }

  async function reconcile(): Promise<void> {
    const snap = controller.getSnapshot();
    const open = new Set(snap.workspaceFolders.map((f) => f.rootPath));
    // Deleting the current key during Map iteration is safe; releasing a lock is not a
    // mutation of this map, and the next pass re-reads the snapshot anyway.
    for (const root of claims.keys()) {
      if (open.has(root)) continue;
      claims.get(root)?.release();
      claims.delete(root);
    }
    for (const folder of snap.workspaceFolders) {
      if (claims.has(folder.rootPath)) continue;
      const claim = await claimProject(folder.rootPath);
      if (claim) {
        claims.set(folder.rootPath, claim);
        continue;
      }
      toast.error(`${folder.name} is already open in another tab — close it there first.`);
      controller.closeFolder(folder.id);
      return; // the snapshot changed under us; the queued reconcile re-reads it
    }
    await bootstrapFromUrl(snap);
  }

  const schedule = (): void => {
    if (disposed) return;
    chain = chain.then(reconcile).catch(() => {});
  };

  const onHide = (): void => {
    for (const claim of claims.values()) claim.release();
    claims.clear();
  };

  // The URL identity and the browser title follow the snapshot synchronously, not the
  // async reconcile: opening a folder must name the project immediately — so an F5 a
  // millisecond later lands back on it, and the title never lags the Explorer.
  const onSnapshot = (): void => {
    const snap = controller.getSnapshot();
    syncProjectParam(snap);
    updateTitle(snap);
    schedule();
  };
  const unsubscribe = controller.subscribe(onSnapshot);
  window.addEventListener("pagehide", onHide);
  schedule();
  return () => {
    disposed = true;
    unsubscribe();
    window.removeEventListener("pagehide", onHide);
    onHide();
  };
}
