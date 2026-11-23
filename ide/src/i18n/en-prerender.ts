// The prerender run + preview catalogue (D-202, issue #85): the in-VM build action,
// its phase narration, its failure codes and the preview render-mode badge.
export const prerenderEn = {
  "prerender.run.action": "Prerender preview",
  "prerender.run.terminalLabel": "prerender build",
  "prerender.run.installing": "Prerender: installing dependencies…",
  "prerender.run.building": "Prerender: building…",
  "prerender.run.ready": "Prerender ready in {seconds}s — {count} route(s)",
  "prerender.error.busy": "A prerender build is already running.",
  "prerender.error.ineligible":
    'prerender-ineligible: route "{route}" is not prerender-eligible ({reasons})',
  "prerender.error.framework": "Prerender build failed — {detail}",
  "prerender.error.vm":
    "The prerender build exited with code {code}. The dev server keeps running; see the prerender build terminal.",
  "prerender.error.timeout":
    "The prerender build exceeded {seconds}s and was stopped. The dev server keeps running.",
  "prerender.badge.prerendered": "Prerendered",
  "prerender.badge.shell": "SPA shell",
  "prerender.badge.prerenderedHint": "Served as prerendered HTML from the in-VM build (D-202).",
  "prerender.badge.shellHint": "Served as the client-rendered SPA shell.",
} as const;
