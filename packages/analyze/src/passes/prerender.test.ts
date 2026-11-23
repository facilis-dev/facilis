import { describe, expect, it } from "vitest";

import { analyzeProject } from "../analyze.ts";
import { createOxcParser } from "../node.ts";
import type { Analysis, PrerenderEligibilityFact } from "../types.ts";
import { prerenderBuildErrors } from "./prerender.ts";

const HEADER = 'import { defineConfig } from "@facilis.dev/core";\n';
const CORE_IMPORT = 'import { defineAuthorizedHandler } from "@facilis.dev/core";\n';
const API_STUB =
  "export async function api(path: string, init: RequestInit = {}): Promise<unknown> {\n" +
  "  return fetch(path, init);\n}\n";
const PUBLIC_ROUTE =
  CORE_IMPORT +
  "export default defineAuthorizedHandler({ permission: [], dbTables: [] }, async () => ({ count: 1 }));\n";
const PRIVATE_ROUTE =
  CORE_IMPORT +
  'export default defineAuthorizedHandler({ permission: ["todos:read"], dbTables: [] }, async () => ({ secret: true }));\n';
const UNKNOWN_PERMISSION_ROUTE =
  CORE_IMPORT +
  "export default defineAuthorizedHandler({ permission: process.env.PERM, dbTables: [] }, async () => null);\n";

const APP = `
import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "./components/require-auth.tsx";
import { PublicOnly } from "./components/public-only.tsx";
import { AdminLayout } from "./layouts/admin.tsx";
import { HomePage } from "./pages/home.tsx";
import { StatsPage } from "./pages/stats.tsx";
import { PrivatePage } from "./pages/private.tsx";
import { SecretPage } from "./pages/secret.tsx";
import { LoginPage } from "./pages/login.tsx";
import { UserPage } from "./pages/user.tsx";
import { AdminPage } from "./pages/admin.tsx";
import { UnknownPage } from "./pages/unknown.tsx";
import { DynamicPage } from "./pages/dynamic.tsx";
export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/stats" element={<StatsPage />} />
      <Route path="/private" element={<PrivatePage />} />
      <Route path="/guarded" element={<RequireAuth><SecretPage /></RequireAuth>} />
      <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/old" element={<Navigate to="/" replace />} />
      <Route path="/users/:id" element={<UserPage />} />
      <Route path="/unknown" element={<UnknownPage />} />
      <Route path="/dynamic-call" element={<DynamicPage />} />
      <Route element={<RequireAuth><AdminLayout /></RequireAuth>}>
        <Route path="/admin" element={<AdminPage />} />
      </Route>
    </Routes>
  );
}
`;

function configWith(routes: string[]): string {
  return (
    HEADER +
    'export default defineConfig({ auth: { defaultRole: "user", roles: { user: [] } }, prerender: { routes: ' +
    JSON.stringify(routes) +
    " } });\n"
  );
}

const FILES: Record<string, string> = {
  "facilis.config.ts": configWith(["/", "/stats"]),
  "src/app.tsx": APP,
  "src/lib/api.ts": API_STUB,
  "src/components/require-auth.tsx":
    "export function RequireAuth({ children }: { children: unknown }) { return <div>{children as never}</div>; }\n",
  "src/components/public-only.tsx":
    "export function PublicOnly({ children }: { children: unknown }) { return <div>{children as never}</div>; }\n",
  "src/layouts/admin.tsx":
    'import { Outlet } from "react-router-dom";\nexport function AdminLayout() { return <main><Outlet /></main>; }\n',
  "src/pages/home.tsx": "export function HomePage() { return <h1>Home</h1>; }\n",
  "src/pages/stats.tsx":
    'import { api } from "../lib/api.ts";\nexport function StatsPage() { api("/api/stats"); return <h1>Stats</h1>; }\n',
  "src/pages/private.tsx":
    'import { api } from "../lib/api.ts";\nexport function PrivatePage() { api("/api/private"); return <h1>Private</h1>; }\n',
  "src/pages/secret.tsx": "export function SecretPage() { return <h1>Secret</h1>; }\n",
  "src/pages/login.tsx": "export function LoginPage() { return <h1>Login</h1>; }\n",
  "src/pages/user.tsx": "export function UserPage() { return <h1>User</h1>; }\n",
  "src/pages/admin.tsx": "export function AdminPage() { return <h1>Admin</h1>; }\n",
  "src/pages/unknown.tsx":
    'import { api } from "../lib/api.ts";\nexport function UnknownPage() { api("/api/unknown-perm"); return <h1>Unknown</h1>; }\n',
  "src/pages/dynamic.tsx":
    'import { api } from "../lib/api.ts";\nexport function DynamicPage({ path }: { path: string }) { api(path); return <h1>Dynamic</h1>; }\n',
  "server/routes/api/stats.get.ts": PUBLIC_ROUTE,
  "server/routes/api/private.get.ts": PRIVATE_ROUTE,
  "server/routes/api/unknown-perm.get.ts": UNKNOWN_PERMISSION_ROUTE,
};

function analysisOf(files: Record<string, string> = FILES): Analysis {
  return analyzeProject({ files: new Map(Object.entries(files)), parser: createOxcParser() });
}

/** The static-template variant of the fixture: no facilis.config.ts (D-202 §2). */
function staticFiles(): Record<string, string> {
  return Object.fromEntries(Object.entries(FILES).filter(([path]) => path !== "facilis.config.ts"));
}

function factOf(analysis: Analysis, path: string): PrerenderEligibilityFact {
  const fact = analysis.prerender.find((entry) => entry.path === path);
  if (fact === undefined) throw new Error("no prerender fact for " + path);
  return fact;
}

describe("prerender eligibility facts", () => {
  it("marks the declared public/static pages eligible (issue #82 acceptance)", () => {
    const analysis = analysisOf();
    const home = factOf(analysis, "/");
    const stats = factOf(analysis, "/stats");
    expect(home).toMatchObject({
      declared: true,
      eligible: true,
      reasons: [],
      pageFile: "src/pages/home.tsx",
    });
    expect(stats).toMatchObject({
      declared: true,
      eligible: true,
      reasons: [],
      pageFile: "src/pages/stats.tsx",
    });
    expect(prerenderBuildErrors(analysis.prerender)).toEqual([]);
  });

  it("names the offending route for a page calling a permission-gated API", () => {
    const fact = factOf(analysisOf(), "/private");
    expect(fact.declared).toBe(false);
    expect(fact.eligible).toBe(false);
    expect(fact.reasons).toContainEqual({ reason: "private-api", route: "GET /api/private" });
  });

  it("treats a RequireAuth-wrapped page as auth-guarded", () => {
    const fact = factOf(analysisOf(), "/guarded");
    expect(fact.eligible).toBe(false);
    expect(fact.reasons).toContainEqual({ reason: "auth-guarded" });
    expect(fact.pageFile).toBe("src/pages/secret.tsx");
  });

  it("treats a PublicOnly-wrapped page as auth-guarded (session-dependent)", () => {
    expect(factOf(analysisOf(), "/login").reasons).toContainEqual({ reason: "auth-guarded" });
  });

  it("inherits a guard from a pathless layout ancestor", () => {
    const fact = factOf(analysisOf(), "/admin");
    expect(fact.reasons).toContainEqual({ reason: "auth-guarded" });
    // The layout itself is chrome, not a page: no fact is emitted for it.
    expect(
      analysisOf().prerender.filter((entry) => entry.pageFile === null && entry.path === "/")
        .length,
    ).toBe(0);
  });

  it("does not count a locally declared component named RequireAuth as the framework guard", () => {
    const files = {
      ...FILES,
      "src/app.tsx": `
import { Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/home.tsx";
function RequireAuth({ children }: { children: unknown }) { return <div>{children as never}</div>; }
export function App() {
  return (
    <Routes>
      <Route path="/" element={<RequireAuth><HomePage /></RequireAuth>} />
    </Routes>
  );
}
`,
      "facilis.config.ts": configWith(["/"]),
    };
    expect(factOf(analysisOf(files), "/").eligible).toBe(true);
  });

  it("marks a Navigate redirect entry as redirect, not a page", () => {
    const fact = factOf(analysisOf(), "/old");
    expect(fact.reasons).toContainEqual({ reason: "redirect" });
    expect(fact.pageFile).toBeNull();
    expect(fact.eligible).toBe(false);
  });

  it("marks a dynamic param route as dynamic-path", () => {
    expect(factOf(analysisOf(), "/users/:id").reasons).toContainEqual({ reason: "dynamic-path" });
  });

  it("fails an enumerated instance of a dynamic route closed (O-021 deferred)", () => {
    const analysis = analysisOf({ ...FILES, "facilis.config.ts": configWith(["/users/42"]) });
    const fact = factOf(analysis, "/users/:id");
    expect(fact.declared).toBe(true);
    expect(fact.reasons).toContainEqual({ reason: "dynamic-path" });
    expect(prerenderBuildErrors(analysis.prerender)).toEqual([
      { code: "prerender-ineligible", route: "/users/:id", reasons: [{ reason: "dynamic-path" }] },
    ]);
  });

  it("marks an unreadable route permission as unknown-security, never public", () => {
    const fact = factOf(analysisOf(), "/unknown");
    expect(fact.reasons).toContainEqual({ reason: "unknown-security" });
    expect(fact.unknown.map((entry) => entry.code)).toContain("prerender-security-unknown");
  });

  it("marks a dynamic API call path as unknown-security", () => {
    const fact = factOf(analysisOf(), "/dynamic-call");
    expect(fact.reasons).toContainEqual({ reason: "unknown-security" });
    // The call's own unknown (page-path-static) is propagated, never dropped.
    expect(fact.unknown.map((entry) => entry.code)).toContain("page-path-static");
  });

  it("fails a declared path that matches no route-table page", () => {
    const analysis = analysisOf({ ...FILES, "facilis.config.ts": configWith(["/nope"]) });
    const fact = factOf(analysis, "/nope");
    expect(fact).toMatchObject({ declared: true, eligible: false, pageFile: null });
    expect(fact.reasons).toContainEqual({ reason: "unknown-security" });
    expect(fact.unknown.map((entry) => entry.code)).toContain("prerender-page-unresolved");
    const diagnostics = analysis.diagnostics.filter(
      (entry) => entry.code === "prerender-ineligible",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.message).toContain("/nope");
  });

  it("emits one error diagnostic per declared-and-ineligible route, naming route and reason", () => {
    const analysis = analysisOf({
      ...FILES,
      "facilis.config.ts": configWith(["/", "/private", "/guarded"]),
    });
    const errors = prerenderBuildErrors(analysis.prerender);
    expect(errors.map((entry) => entry.route)).toEqual(["/private", "/guarded"]);
    const diagnostics = analysis.diagnostics.filter(
      (entry) => entry.code === "prerender-ineligible",
    );
    expect(diagnostics.map((entry) => entry.message)).toEqual([
      'prerender route "/private" is not prerender-eligible (private-api: GET /api/private)',
      'prerender route "/guarded" is not prerender-eligible (auth-guarded)',
    ]);
  });

  it("keeps undeclared pages as facts but never as build errors", () => {
    const analysis = analysisOf({ ...FILES, "facilis.config.ts": configWith([]) });
    expect(factOf(analysis, "/").declared).toBe(false);
    expect(factOf(analysis, "/private").eligible).toBe(false);
    expect(prerenderBuildErrors(analysis.prerender)).toEqual([]);
    expect(analysis.diagnostics.filter((entry) => entry.code === "prerender-ineligible")).toEqual(
      [],
    );
  });

  it("reads the static-template declaration from vite.config.ts", () => {
    const analysis = analysisOf({
      ...staticFiles(),
      "vite.config.ts":
        'import { defineConfig } from "vite";\n' +
        'import { prerender } from "@facilis.dev/nitro/prerender";\n' +
        'export default defineConfig({ plugins: [prerender({ routes: ["/", "/stats"] })] });\n',
    });
    expect(factOf(analysis, "/").declared).toBe(true);
    expect(factOf(analysis, "/stats").declared).toBe(true);
    expect(factOf(analysis, "/private").declared).toBe(false);
    // The config-missing diagnostic behavior for static projects stays as-is.
    expect(analysis.diagnostics.some((entry) => entry.code === "config-missing")).toBe(true);
  });

  it("ignores a local function named prerender in vite.config.ts", () => {
    const analysis = analysisOf({
      ...staticFiles(),
      "vite.config.ts":
        "function prerender(options: unknown) { return options; }\n" +
        'export default { plugins: [prerender({ routes: ["/"] })] };\n',
    });
    expect(factOf(analysis, "/").declared).toBe(false);
  });

  it("never executes project code (D-092 zero execution)", () => {
    const analysis = analysisOf({
      ...FILES,
      "src/lib/boom.ts": 'throw new Error("project code must never run");\n',
    });
    expect(factOf(analysis, "/").eligible).toBe(true);
  });
});
