import { StrictMode, useEffect } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";
import { App } from "./app.tsx";
import { appBasePath } from "./lib/api.ts";
import { applyStoredLocale, initI18n } from "./lib/i18n.tsx";
import { PrerenderDataProvider, readPrerenderIsland, shouldHydrate } from "./lib/prerender.tsx";
import { initTheme } from "./lib/theme.ts";

// The theme is applied before mount on both paths: it only writes <html data-theme> outside the
// React tree, so it cannot cause a hydration mismatch. Catalogues boot with the default locale
// only; stored preferences are applied per path below (D-202 §4).
initTheme();
initI18n();

/**
 * Hydration-only: applying stored preferences in an effect keeps the first client render equal
 * to the server HTML. The client-only path applies them before render instead (no en/it flash).
 */
function ApplyStoredLocale() {
  useEffect(() => {
    applyStoredLocale();
  }, []);
  return null;
}

const container = document.getElementById("root");
if (container === null) throw new Error("index.html is missing #root");

const island = readPrerenderIsland();
const hydrating = shouldHydrate(container, island);

// basename makes the same build work at "/" and under the IDE preview's "/preview/<port>/".
const tree = (
  <StrictMode>
    <PrerenderDataProvider data={island}>
      <BrowserRouter basename={appBasePath()}>
        {hydrating ? <ApplyStoredLocale /> : null}
        <App />
      </BrowserRouter>
    </PrerenderDataProvider>
  </StrictMode>
);

if (hydrating) {
  hydrateRoot(container, tree, {
    onRecoverableError: (error) => console.error("Recoverable hydration error:", error),
  });
} else {
  applyStoredLocale();
  createRoot(container).render(tree);
}
