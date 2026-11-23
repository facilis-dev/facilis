import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { analyzeProject } from "@facilis.dev/analyze";

import { fetchPublicData, pagePublicGets } from "./prerender-data.ts";
import { createRolldownParser } from "./rolldown-parser.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const PROJECT: Record<string, string> = {
  "facilis.config.ts":
    'import { defineConfig } from "@facilis.dev/core";\n' +
    'export default defineConfig({ auth: { defaultRole: "user", roles: { user: [] } }, prerender: { routes: ["/stats"] } });\n',
  "src/app.tsx":
    'import { Route, Routes } from "react-router-dom";\n' +
    'import { StatsPage } from "./pages/stats.tsx";\n' +
    'export function App() { return <Routes><Route path="/stats" element={<StatsPage />} /></Routes>; }\n',
  "src/lib/api.ts":
    "export async function api(path: string): Promise<unknown> { return fetch(path); }\n",
  "src/pages/stats.tsx":
    'import { api } from "../lib/api.ts";\n' +
    'export function StatsPage() { api("/api/stats"); api("/api/write", { method: "POST" }); return <h1>Stats</h1>; }\n',
  "server/routes/api/stats.get.ts":
    'import { defineAuthorizedHandler } from "@facilis.dev/core";\n' +
    'export default defineAuthorizedHandler({ permission: [], dbTables: [] }, async () => ({ count: 1 }));\n',
  "server/routes/api/private.get.ts":
    'import { defineAuthorizedHandler } from "@facilis.dev/core";\n' +
    'export default defineAuthorizedHandler({ permission: ["x"], dbTables: [] }, async () => null);\n',
  "server/routes/api/write.post.ts":
    'import { defineAuthorizedHandler } from "@facilis.dev/core";\n' +
    'export default defineAuthorizedHandler({ permission: [], dbTables: [] }, async () => null);\n',
};

describe("pagePublicGets", () => {
  it("returns only the public GET paths a page calls", () => {
    const analysis = analyzeProject({ files: new Map(Object.entries(PROJECT)), parser: createRolldownParser() });
    const fact = analysis.prerender.find((candidate) => candidate.path === "/stats");
    expect(fact?.eligible).toBe(true);
    if (fact === undefined) throw new Error("no /stats fact");
    expect(pagePublicGets(analysis, fact)).toEqual(["/api/stats"]);
  });
});

/** A temp "built server entry" that hands a controlled handler to the srvx loader hook. */
function entryWith(handlerSource: string): string {
  const root = mkdtempSync(join(tmpdir(), "facilis-prerender-entry-"));
  roots.push(root);
  const file = join(root, `entry-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(
    file,
    `globalThis.__received = [];\nconst handler = (req, res) => { globalThis.__received.push(req.headers); ${handlerSource} };\n` +
      "globalThis.__srvxLoader__({ server: { node: { handler }, close: async () => {} } });\n",
  );
  return file;
}

const OK = 'res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ count: 42 }));';

describe("fetchPublicData", () => {
  it("keys 200 JSON responses by request path and sends no identity", async () => {
    const entry = entryWith(OK);
    const data = await fetchPublicData(entry, ["/api/stats"]);
    expect(data).toEqual({ "/api/stats": { count: 42 } });
    const received = (globalThis as { __received?: Record<string, unknown>[] }).__received ?? [];
    expect(received.length).toBe(1);
    expect(received[0]?.["cookie"]).toBeUndefined();
    expect(received[0]?.["authorization"]).toBeUndefined();
  });

  it("returns {} for no paths without booting a server", async () => {
    expect(await fetchPublicData("/nonexistent-entry.mjs", [])).toEqual({});
  });

  it.each([401, 403, 500])("fails closed on %i — an error body is never a page", async (status) => {
    const entry = entryWith(`res.statusCode = ${status}; res.end(JSON.stringify({ code: "unauthorized" }));`);
    await expect(fetchPublicData(entry, ["/api/stats"])).rejects.toThrow(
      new RegExp(`prerender-data.*${status}`),
    );
  });

  it("fails closed on a redirect (never follows a login bounce)", async () => {
    const entry = entryWith('res.statusCode = 302; res.setHeader("location", "/login"); res.end();');
    await expect(fetchPublicData(entry, ["/api/stats"])).rejects.toThrow(/prerender-data/);
  });

  it("restores NODE_ENV after the boot", async () => {
    const previous = process.env["NODE_ENV"];
    const entry = entryWith(OK);
    await fetchPublicData(entry, ["/api/stats"]);
    expect(process.env["NODE_ENV"]).toBe(previous);
  });
});
