import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppRoutes } from "./app.tsx";
import { PrerenderDataContext } from "./lib/data-context.ts";
import { initI18n, initTheme, parseEmbeddedState } from "./lib/state.ts";

declare global {
  interface Window {
    __PRERENDER_ERRORS__?: string[];
    __PRERENDER_READY__?: boolean;
    __PRERENDER_MODE__?: "hydrate" | "client";
  }
}

initTheme();
initI18n();

const state = parseEmbeddedState();
const container = document.getElementById("root");
const errors: string[] = [];
window.__PRERENDER_ERRORS__ = errors;
window.__PRERENDER_READY__ = false;

// The IDE's same-origin preview serves the app under /preview/<port>/ while
// the VM server sees root-relative paths: the client router needs that prefix
// as its basename (the generated template does the same via appBasePath()).
const basename = (location.pathname.match(/^\/preview\/\d+/) || [""])[0];

if (container !== null) {
  const tree = (
    <PrerenderDataContext.Provider value={state}>
      <BrowserRouter basename={basename}>
        <AppRoutes />
      </BrowserRouter>
    </PrerenderDataContext.Provider>
  );
  // Prerendered HTML present -> hydrate the identical tree with the embedded
  // state; empty shell -> client render. Recoverable errors are collected for
  // the smoke runner (acceptance: zero).
  const serverRendered = container.childElementCount > 0;
  window.__PRERENDER_MODE__ = serverRendered ? "hydrate" : "client";
  if (serverRendered) {
    hydrateRoot(container, tree, {
      onRecoverableError: (error) => {
        errors.push(error instanceof Error ? error.message : String(error));
      },
    });
  } else {
    createRoot(container).render(tree);
  }
  requestAnimationFrame(() => {
    window.__PRERENDER_READY__ = true;
  });
}
