// `templates.ts` behind a dynamic import, so the template corpus is its own chunk.
//
// The corpus is the whole catalog's source: every file of every template, as
// string literals. It is ~413 KB of source (~20% of the entry chunk after
// brotli), and a visitor downloads and parses all of it to scaffold exactly one
// template — or, on a return visit to an existing project, none.
//
// Rolldown only splits a module out when NOTHING imports it statically, so both
// call sites (the Home picker and the controller's create/open paths) have to
// come through here. `import type` is erased at compile time, so type-only
// imports of `TemplateDef` and friends are still free and stay direct.
//
// One promise per process, so the picker prefetching on open and the controller
// awaiting the same module a moment later share a single fetch — but only while
// it is pending or fulfilled. A rejected import is dropped rather than cached:
// a chunk that failed on a flaky connection would otherwise poison every later
// attempt for the lifetime of the tab, and "Unknown template" is a much worse
// thing to show than a second attempt.

import type { TemplateDef } from "./templates";

export type TemplatesModule = typeof import("./templates");
export type FacilisTemplateModule = typeof import("../facilis/facilis-template");

let pending: Promise<TemplatesModule> | null = null;

/**
 * Merge the Facilis probe template into the upstream catalog.
 *
 * `templates.ts` is at its file-length baseline and may not grow, so the merge
 * lives here. The Facilis payload is loaded as its own lazy chunk (never a static
 * import, or it would land in the entry chunk) and appended to TEMPLATES;
 * getTemplate prefers it, so reopening a created Facilis project re-attaches the
 * same manifest. Both modules are loaded in one promise, so a picker prefetch and
 * the controller's later await share a single fetch.
 */
function withFacilisCatalog(mod: TemplatesModule, facilis: TemplateDef): TemplatesModule {
  return {
    ...mod,
    TEMPLATES: [...mod.TEMPLATES, facilis],
    getTemplate: (id: string) => (id === facilis.manifest.id ? facilis : mod.getTemplate(id)),
  };
}

/** Load (once) and return the template catalog, including the Facilis probe. */
export function loadTemplates(): Promise<TemplatesModule> {
  if (!pending) {
    const p = Promise.all([import("./templates"), import("../facilis/facilis-template")]).then(
      ([mod, facilisModule]) =>
        withFacilisCatalog(mod, facilisModule.createFacilisTemplate(location.origin)),
    );
    p.catch(() => {
      if (pending === p) pending = null;
    });
    pending = p;
  }
  return pending;
}

/**
 * Start the fetch without waiting for it, for the moment a user signals intent
 * (opening the picker), so the corpus is usually resident by the time they have
 * chosen something. Failures are the caller's problem, not the prefetch's.
 */
export function prefetchTemplates(): void {
  void loadTemplates().catch(() => {});
}
