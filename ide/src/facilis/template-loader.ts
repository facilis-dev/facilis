// The Facilis template behind a dynamic import, so its source is its own chunk.
//
// The template payload is the whole project as string literals (project files plus the
// server/client/db modules). Home's first paint, an open editor and every non-create boot
// do not need it, so it is fetched only when a project is created or reopened — the same
// reason the old template catalog was lazy.
//
// One promise per process: a create and a later reopen share the fetch. A rejected import
// is dropped rather than cached, so a flaky connection costs a retry, not the tab.
import type { ProjectTemplate } from "../vv/project-manifest";

let pending: Promise<ProjectTemplate> | null = null;

export function loadFacilisTemplate(): Promise<ProjectTemplate> {
  if (!pending) {
    const p = import("./facilis-template").then((module) => module.createFacilisTemplate());
    p.catch(() => {
      if (pending === p) pending = null;
    });
    pending = p;
  }
  return pending;
}
