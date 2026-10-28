// Client half of the Facilis probe template.
//
// src/App.tsx is also the smoke contract: on mount it fetches the framework
// endpoints and exposes each result as a data-* attribute on <html>, so the
// headless acceptance run can assert framework behaviour from the page alone.

const mainTsx = `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const container = document.getElementById("root");
if (container === null) throw new Error("index.html is missing #root");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;

const appTsx = `import { useEffect, useState } from "react";

interface Probe {
  health: string;
  manifest: string;
  warnings: string;
  revision: string;
  openapi: string;
  todos: string;
}

interface ProbeResult {
  status: number;
  ok: boolean;
  body: unknown;
}

// The preview proxy serves this app under /preview/<port>/ and strips that prefix
// before the request reaches the in-VM dev server, so an absolute "/__facilis/..."
// would leave the VM. Recover the proxy prefix from the pathname when there is one.
function proxyPrefix(): string {
  const parts = window.location.pathname.split("/").filter((part) => part.length > 0);
  if (parts.length >= 2 && parts[0] === "preview" && /^[0-9]+$/.test(parts[1])) {
    return "/preview/" + parts[1];
  }
  return "";
}

function endpoint(path: string): string {
  return proxyPrefix() + path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function probe(path: string): Promise<ProbeResult> {
  try {
    const response = await fetch(endpoint(path));
    const body: unknown = await response.json().catch(() => null);
    return { status: response.status, ok: response.ok, body };
  } catch {
    return { status: 0, ok: false, body: null };
  }
}

function readWarnings(body: unknown): string {
  if (!isRecord(body) || !Array.isArray(body.warnings)) return "0";
  return String(body.warnings.length);
}

function readRevision(body: unknown): string {
  if (!isRecord(body) || typeof body.revision !== "string") return "";
  return body.revision;
}

// The facade is only "ok" when Nitro served /api/todos AND the AST pass carried
// the route's dbTables through to the operation as x-db-tables (SPEC 6.9).
function readOpenapi(body: unknown): string {
  const paths = isRecord(body) ? body.paths : undefined;
  const pathItem = isRecord(paths) ? paths["/api/todos"] : undefined;
  const operation = isRecord(pathItem) ? pathItem["get"] : undefined;
  return isRecord(operation) && operation["x-db-tables"] !== undefined ? "ok" : "missing";
}

export function App() {
  const [state, setState] = useState<Probe | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const healthResult = await probe("/__facilis/health");
      const health = healthResult.ok ? "ok" : "error:" + healthResult.status;

      const manifestResult = await probe("/__facilis/manifest");
      const manifest = manifestResult.ok ? "ok" : "error:" + manifestResult.status;

      const openapiResult = await probe("/_openapi.json");
      const openapi = openapiResult.ok
        ? readOpenapi(openapiResult.body)
        : "error:" + openapiResult.status;

      const todosResult = await probe("/api/todos");
      const todos = String(todosResult.status);
      if (!live) return;

      const warnings = manifest === "ok" ? readWarnings(manifestResult.body) : "";
      const revision = manifest === "ok" ? readRevision(manifestResult.body) : "";

      const root = document.documentElement;
      root.dataset["facilisHealth"] = health;
      root.dataset["facilisManifest"] = manifest;
      if (manifest === "ok") {
        root.dataset["facilisWarnings"] = warnings;
        root.dataset["facilisRevision"] = revision;
      }
      root.dataset["facilisOpenapi"] = openapi;
      root.dataset["facilisTodos"] = todos;

      setState({ health, manifest, warnings, revision, openapi, todos });
    })();
    return () => {
      live = false;
    };
  }, []);

  return (
    <main className="page">
      <h1>Facilis</h1>
      <p className="tagline">A Facilis app running in the browser IDE.</p>
      {state === null ? (
        <p className="summary">Probing the framework…</p>
      ) : (
        <ul className="summary">
          <li>health: {state.health}</li>
          <li>
            manifest: {state.manifest} ({state.warnings} warnings)
          </li>
          <li>revision: {state.revision.length > 0 ? state.revision : "n/a"}</li>
          <li>openapi: {state.openapi}</li>
          <li>todos: {state.todos}</li>
        </ul>
      )}
      <p className="muted">Edit src/App.tsx and save to test HMR.</p>
    </main>
  );
}
`;

const styles = `:root {
  font-family: system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  color-scheme: dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #101014;
}
body {
  margin: 0;
  display: grid;
  place-items: center;
  min-height: 100vh;
}
.page {
  width: 100%;
  max-width: 720px;
  padding: 2rem;
  box-sizing: border-box;
}
h1 {
  font-size: 2.2rem;
  margin: 0 0 0.25rem;
}
.tagline {
  color: #9ca3af;
  margin: 0 0 1.5rem;
}
.summary {
  list-style: none;
  padding: 0;
  margin: 0 0 1.5rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9rem;
}
.summary li {
  background: #1b1b22;
  border: 1px solid #26262f;
  border-radius: 6px;
  padding: 0.35rem 0.6rem;
  margin-bottom: 0.35rem;
}
.muted {
  color: #6b7280;
  font-size: 0.85rem;
  margin: 0;
}
`;

const locales =
  JSON.stringify(
    {
      "app.title": "Facilis",
      "app.tagline": "A Facilis app running in the browser IDE.",
      "app.probing": "Probing the framework…",
      "app.hmr": "Edit src/App.tsx and save to test HMR.",
    },
    null,
    2,
  ) + "\n";

export const clientFiles: Record<string, string> = {
  "src/main.tsx": mainTsx,
  "src/App.tsx": appTsx,
  "src/styles.css": styles,
  "locales/en.json": locales,
};
