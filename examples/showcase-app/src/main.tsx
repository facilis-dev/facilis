import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";
import { App } from "./app.tsx";
import { appBasePath } from "./lib/app-base.ts";
import { initI18n } from "./lib/i18n.tsx";
import { initTheme } from "./lib/theme.ts";

// Theme and catalogue must be applied before the first render so the first paint already has
// the stored theme and language.
initTheme();
initI18n();

const container = document.getElementById("root");
if (container === null) throw new Error("index.html is missing #root");

// basename makes the same build work at "/" and under the IDE preview's "/preview/<port>/".
createRoot(container).render(
  <StrictMode>
    <BrowserRouter basename={appBasePath()}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
