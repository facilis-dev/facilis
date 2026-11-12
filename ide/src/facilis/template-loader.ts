// Per-template lazy loading, so each template's payload is its own chunk.
//
// The payload is the whole project as string literals, so Home's first paint, an open
// editor and every non-create boot do not need it: the descriptor's loader is called only
// when a project is created or reopened (templates.ts). One promise per key per process: a
// create and a later reopen share the fetch. A rejected import is dropped rather than
// cached, so a flaky connection costs a retry, not the tab.
import type { ProjectTemplate } from "../vv/project-manifest";

/** A template module's factory; the dynamic import itself stays at the descriptor. */
export type TemplateModuleLoader = () => Promise<ProjectTemplate>;

const pending = new Map<string, Promise<ProjectTemplate>>();

/** Load one template, at most once per process, keyed by its descriptor key. */
export function loadTemplateOnce(
  key: string,
  load: TemplateModuleLoader,
): Promise<ProjectTemplate> {
  const cached = pending.get(key);
  if (cached !== undefined) return cached;
  const promise = load();
  promise.catch(() => {
    if (pending.get(key) === promise) pending.delete(key);
  });
  pending.set(key, promise);
  return promise;
}
