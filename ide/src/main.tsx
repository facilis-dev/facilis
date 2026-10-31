import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import "@xterm/xterm/css/xterm.css";
import "./index.css";
import App from "./App.tsx";
import { markBoot } from "./vv/boot-marks";
import { initI18n } from "./i18n";
import { THEME_ATTRIBUTES } from "./ui-themes";

markBoot("js-executed");
initI18n();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider
      attribute="data-theme"
      value={THEME_ATTRIBUTES}
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <App />
    </ThemeProvider>
  </StrictMode>,
);
