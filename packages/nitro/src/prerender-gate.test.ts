import { describe, expect, it } from "vitest";

import { analyzeProject, type Analysis, type PrerenderEligibilityFact } from "@facilis.dev/analyze";

import {
  facilisPrerenderGate,
  formatPrerenderBuildError,
  PRERENDER_GATE_PLUGIN_NAME,
} from "./prerender-gate.ts";
import { emptyAnalysis } from "./route-metadata-test-harness.ts";
import { createRolldownParser } from "./rolldown-parser.ts";

type HookFn = (this: unknown, ...args: unknown[]) => unknown;

function fact(overrides: Partial<PrerenderEligibilityFact> = {}): PrerenderEligibilityFact {
  return {
    path: "/about",
    declared: true,
    eligible: false,
    reasons: [{ reason: "private-api", route: "GET /api/private" }],
    pageFile: "src/pages/about.tsx",
    source: { file: "src/app.tsx", line: 3 },
    unknown: [],
    ...overrides,
  };
}

/** Run buildStart the way Vite does: this.error aborts the build on the first failure. */
function runBuildStart(analysis: Analysis | undefined): string[] {
  const plugin = facilisPrerenderGate(() => analysis);
  const errors: string[] = [];
  const context = {
    error: (message: string) => {
      errors.push(message);
      throw new Error(message);
    },
  };
  try {
    (plugin.buildStart as HookFn).call(context);
  } catch {
    // this.error throwing is the failure contract; the message is already captured.
  }
  return errors;
}

const CORE_IMPORT = 'import { defineAuthorizedHandler } from "@facilis.dev/core";\n';
const PRIVATE_ROUTE =
  CORE_IMPORT +
  'export default defineAuthorizedHandler({ permission: ["todos:read"], dbTables: [] }, async () => null);\n';

const INELIGIBLE_PROJECT: Record<string, string> = {
  "facilis.config.ts":
    'import { defineConfig } from "@facilis.dev/core";\n' +
    'export default defineConfig({ auth: { defaultRole: "user", roles: { user: [] } }, prerender: { routes: ["/private"] } });\n',
  "src/app.tsx":
    'import { Route, Routes } from "react-router-dom";\n' +
    'import { PrivatePage } from "./pages/private.tsx";\n' +
    'export function App() { return <Routes><Route path="/private" element={<PrivatePage />} /></Routes>; }\n',
  "src/lib/api.ts":
    "export async function api(path: string): Promise<unknown> { return fetch(path); }\n",
  "src/pages/private.tsx":
    'import { api } from "../lib/api.ts";\nexport function PrivatePage() { api("/api/private"); return <h1>Private</h1>; }\n',
  "server/routes/api/private.get.ts": PRIVATE_ROUTE,
};

describe("facilisPrerenderGate", () => {
  it("is a build-only companion plugin", () => {
    const plugin = facilisPrerenderGate(() => undefined);
    expect(plugin.name).toBe(PRERENDER_GATE_PLUGIN_NAME);
    expect(plugin.apply).toBe("build");
  });

  it("fails the build with the framework code, route and reason", () => {
    const errors = runBuildStart(emptyAnalysis({ prerender: [fact()] }));
    expect(errors).toEqual([
      '[facilis] prerender-ineligible: route "/about" is not prerender-eligible (private-api: GET /api/private)',
    ]);
  });

  it("renders every reason, naming each offending API route", () => {
    const message = formatPrerenderBuildError({
      code: "prerender-ineligible",
      route: "/admin",
      reasons: [
        { reason: "auth-guarded" },
        { reason: "private-api", route: "GET /api/users" },
        { reason: "private-api", route: "POST /api/users" },
      ],
    });
    expect(message).toBe(
      '[facilis] prerender-ineligible: route "/admin" is not prerender-eligible (auth-guarded; private-api: GET /api/users; private-api: POST /api/users)',
    );
  });

  it("is silent when prerendering is off", () => {
    expect(runBuildStart(emptyAnalysis({ prerender: [] }))).toEqual([]);
  });

  it("is silent for declared-and-eligible routes", () => {
    expect(
      runBuildStart(emptyAnalysis({ prerender: [fact({ eligible: true, reasons: [] })] })),
    ).toEqual([]);
  });

  it("is silent for ineligible routes that are not declared", () => {
    expect(runBuildStart(emptyAnalysis({ prerender: [fact({ declared: false })] }))).toEqual([]);
  });

  it("is silent when there is no analysis (absent root)", () => {
    expect(runBuildStart(undefined)).toEqual([]);
  });

  it("gates a real analysis end to end", () => {
    const analysis = analyzeProject({
      files: new Map(Object.entries(INELIGIBLE_PROJECT)),
      parser: createRolldownParser(),
    });
    const errors = runBuildStart(analysis);
    expect(errors).toEqual([
      '[facilis] prerender-ineligible: route "/private" is not prerender-eligible (private-api: GET /api/private)',
    ]);
  });
});
