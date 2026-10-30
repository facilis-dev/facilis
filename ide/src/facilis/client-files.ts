// Client half of the Facilis probe template.
//
import { clientLocales, clientStyles } from "./client-assets";
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
  auth: string;
  dbInsert: string;
  dbQuery: string;
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

interface PostResult extends ProbeResult {
  // Failure body, kept only for the smoke's diagnostics file (a 500 from the in-VM
  // server explains itself there instead of as "error:500" with no reason).
  detail?: string;
}

async function postJson(path: string, body: unknown): Promise<PostResult> {
  try {
    const response = await fetch(endpoint(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    return { status: response.status, ok: response.ok, body: payload, detail: cursor(text) };
  } catch (error) {
    return { status: 0, ok: false, body: null, detail: String(error) };
  }
}

function cursor(text: string): string {
  return text.slice(0, 400);
}

function containsTitle(list: unknown, title: string): boolean {
  return Array.isArray(list) && list.some((row) => isRecord(row) && row.title === title);
}

// The database roundtrip is page-scoped, not effect-scoped: React StrictMode runs mount
// effects twice in development, and two logins racing made the reported result depend on
// which run finished last. The email/title are minted once for the same reason.
const PROBE_EMAIL = "probe-" + Date.now() + "@facilis.test";
const PROBE_PASSWORD = "probe-password";
const PROBE_TITLE = "probe-" + Date.now();

interface Roundtrip {
  auth: string;
  dbInsert: string;
  dbQuery: string;
}

let roundtrip: Promise<Roundtrip> | null = null;

function databaseRoundtrip(): Promise<Roundtrip> {
  roundtrip ??= (async () => {
    const registered = await postJson("/api/auth/register", {
      email: PROBE_EMAIL,
      password: PROBE_PASSWORD,
    });
    // 409 = already registered: a second mount of this effect, not a failure.
    const registeredOk = registered.ok || registered.status === 409;
    const loggedIn = await postJson("/api/auth/login", {
      email: PROBE_EMAIL,
      password: PROBE_PASSWORD,
    });
    const session = await probe("/api/auth/session");
    const authenticated = isRecord(session.body) && session.body.authenticated === true;
    const auth = authenticated ? "ok" : "anon:" + JSON.stringify(session.body).slice(0, 160);
    const inserted = await postJson("/api/todos", { title: PROBE_TITLE });
    const dbInsert =
      registeredOk && loggedIn.ok && inserted.ok
        ? "ok"
        : "error:" + registered.status + "/" + loggedIn.status + "/" + inserted.status;
    const listed = await probe("/api/todos");
    const dbQuery = containsTitle(listed.body, PROBE_TITLE) ? "ok" : "error:" + listed.status;
    return { auth, dbInsert, dbQuery };
  })();
  return roundtrip;
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

      // Database roundtrip through the real contract: register, log in (the session cookie
      // travels through the preview's cookie jar), insert a todo through the authorized
      // handler, then read the list back. Nothing else proves PGlite, the migrations, RLS
      // and permissions work inside the WebContainer.
      const { auth, dbInsert, dbQuery } = await databaseRoundtrip();
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
      root.dataset["facilisAuth"] = auth;
      root.dataset["facilisDbInsert"] = dbInsert;
      root.dataset["facilisDbQuery"] = dbQuery;

      setState({ health, manifest, warnings, revision, openapi, todos, auth, dbInsert, dbQuery });
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
          <li>session: {state.auth}</li>
          <li>db insert: {state.dbInsert}</li>
          <li>db query: {state.dbQuery}</li>
        </ul>
      )}
      <p className="muted">Edit src/App.tsx and save to test HMR.</p>
    </main>
  );
}
`;

export const clientFiles: Record<string, string> = {
  "src/main.tsx": mainTsx,
  "src/App.tsx": appTsx,
  "src/styles.css": clientStyles,
  "locales/en.json": clientLocales,
};
