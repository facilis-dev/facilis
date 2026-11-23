import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app.tsx";
import { PrerenderDataProvider, readPrerenderIsland, shouldHydrate } from "./lib/prerender.tsx";

declare global {
  interface Window {
    __PRERENDER_MODE__?: "hydrate" | "client";
    __PRERENDER_ERRORS__?: string[];
  }
}

const container = document.getElementById("root");
if (container !== null) {
  const island = readPrerenderIsland();
  const errors: string[] = [];
  window.__PRERENDER_ERRORS__ = errors;
  const tree = (
    <PrerenderDataProvider data={island}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </PrerenderDataProvider>
  );
  if (shouldHydrate(container, island)) {
    window.__PRERENDER_MODE__ = "hydrate";
    hydrateRoot(container, tree, {
      onRecoverableError: (error) => {
        errors.push(error instanceof Error ? error.message : String(error));
      },
    });
  } else {
    window.__PRERENDER_MODE__ = "client";
    createRoot(container).render(tree);
  }
}