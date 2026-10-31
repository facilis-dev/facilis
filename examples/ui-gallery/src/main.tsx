import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@facilis/ui/theme.css";
import "./index.css";
import { App } from "./app.tsx";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Gallery root element #root is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
