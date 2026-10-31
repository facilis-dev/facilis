// Where a tab lands on its first paint: Home, or straight into the project its URL
// names.
//
// A tab's URL always carries ?project=<rootPath> while it has a project (D-035), so a
// reload can return to it. The snapshot's INITIAL view has to reflect that parameter:
// starting from "home" and switching only after the kernel booted is what made every
// reload flash the project-selection screen before the IDE appeared. A shared link
// already starts on the workspace; a reload had no equivalent.
//
// Pure, and shared by the controller's initial snapshot and project-tabs' bootstrap, so
// both read the URL the same way and this is testable without a browser.
export interface BootTarget {
  /** The project this tab boots into, or null when it opens Home. */
  project: string | null;
  view: "home" | "workspace";
}

export function projectParamIn(search: string): string | null {
  return new URLSearchParams(search).get("project") || null;
}

export function bootTargetFrom(search: string, hash: string): BootTarget {
  // A shared link bootstraps a brand-new project and never lands on Home; it carries a
  // #share= payload rather than ?project=.
  if (hash.includes("#share=")) return { project: null, view: "workspace" };
  const project = projectParamIn(search);
  return { project, view: project ? "workspace" : "home" };
}
