import { describe, expect, it } from "vitest";

import { DEFAULT_TRANSPORT } from "../analyze.ts";
import { createModuleGraph } from "../module-graph.ts";
import { createOxcParser } from "../node.ts";
import { buildConfigFacts, emptyConfigFacts } from "./config.ts";
import { buildRouteFacts } from "./routes.ts";
import { buildPageFacts, type TransportSpec } from "./clients.ts";
import { loadFixtureProject } from "../../test-fixtures/load.ts";

const CORE_IMPORT = 'import { defineAuthorizedHandler } from "@facilis/core";\n';
const API_STUB =
  "export async function api(path: string, init: RequestInit = {}): Promise<unknown> {\n" +
  "  return fetch(path, init);\n}\n";
const EMPTY_ROUTE =
  CORE_IMPORT +
  "export default defineAuthorizedHandler({ permission: [], dbTables: [] }, async () => null);\n";

function graphOf(files: Record<string, string>) {
  return createModuleGraph({ files: new Map(Object.entries(files)), parser: createOxcParser() });
}

function pagesOf(files: Record<string, string>, transport: TransportSpec = DEFAULT_TRANSPORT) {
  const graph = graphOf(files);
  const routes = buildRouteFacts(graph, emptyConfigFacts()).routes;
  return buildPageFacts(graph, routes, transport);
}

function fixturePages() {
  const graph = createModuleGraph({ files: loadFixtureProject(), parser: createOxcParser() });
  const routes = buildRouteFacts(graph, buildConfigFacts(graph).facts).routes;
  return buildPageFacts(graph, routes, DEFAULT_TRANSPORT);
}

describe("buildPageFacts on the fixture project", () => {
  it("lists every src file except the transport module, sorted", () => {
    const { pages } = fixturePages();
    expect(pages.map((page) => page.path + " " + page.kind)).toEqual([
      "src/components/todo-form.tsx component",
      "src/lib/i18n.ts lib",
      "src/lib/todos.ts lib",
      "src/pages/todos.tsx page",
      "src/pages/unsafe.tsx page",
    ]);
  });

  it("reads a literal call with a static method", () => {
    const form = fixturePages().pages.find((page) => page.path === "src/components/todo-form.tsx");
    expect(form?.calls).toHaveLength(1);
    expect(form?.calls[0]).toMatchObject({
      expression: '"/api/todos"',
      kind: "literal",
      staticPrefix: "/api/todos",
      matchedRouteIds: ["route:POST /api/todos"],
      unknown: [],
    });
  });

  it("matches literal and dynamic-prefix calls against the route templates", () => {
    const page = fixturePages().pages.find((item) => item.path === "src/pages/todos.tsx");
    expect(page?.calls.map((call) => [call.kind, call.staticPrefix, call.matchedRouteIds])).toEqual(
      [
        ["literal", "/api/todos", ["route:GET /api/todos"]],
        ["builder", "/api/todos/", []],
        ["concat", "/api/todos/", []],
      ],
    );
    expect(page?.calls[1]?.expression).toBe("todoPath(id)");
  });

  it("records a bare fetch as a client-transport violation", () => {
    const { pages, diagnostics } = fixturePages();
    const page = pages.find((item) => item.path === "src/pages/unsafe.tsx");
    expect(page?.calls[0]?.matchedRouteIds).toEqual(["route:GET /api/todos"]);
    expect(page?.calls[0]?.unknown.map((item) => item.code)).toEqual(["client-transport"]);
    expect(diagnostics.map((item) => item.code)).toEqual(["client-transport"]);
    expect(diagnostics[0]?.source?.file).toBe("src/pages/unsafe.tsx");
  });
});

describe("buildPageFacts path handling", () => {
  it("warns when the path is fully dynamic", () => {
    const { pages, diagnostics } = pagesOf({
      "src/lib/api.ts": API_STUB,
      "src/pages/stuck.tsx":
        'import { api } from "../lib/api.ts";\n' +
        "export async function load(path: string): Promise<void> { await api(path); }",
    });
    expect(pages[0]?.calls[0]?.kind).toBe("dynamic");
    expect(pages[0]?.calls[0]?.matchedRouteIds).toEqual([]);
    expect(diagnostics.map((item) => item.code)).toEqual(["page-path-static"]);
  });

  it("matches literal, concat and template calls by method and segments", () => {
    const templateCall = "export async function c(id: string): Promise<void> { await api(PATH); }";
    const page = pagesOf({
      "src/lib/api.ts": API_STUB,
      "server/routes/api/todos/index.get.ts": EMPTY_ROUTE,
      "server/routes/api/todos/[id].get.ts": EMPTY_ROUTE,
      "src/pages/todos.tsx":
        'import { api } from "../lib/api.ts";\n' +
        'export async function a(): Promise<void> { await api("/api/todos"); }\n' +
        'export async function b(id: string): Promise<void> { await api("/api/todos/" + id); }\n' +
        templateCall.replace("PATH", "`/api/todos/${id}`"),
    }).pages[0];
    expect(page?.calls.map((call) => call.kind)).toEqual(["literal", "concat", "template"]);
    expect(page?.calls.map((call) => call.matchedRouteIds)).toEqual([
      ["route:GET /api/todos"],
      ["route:GET /api/todos/{id}"],
      ["route:GET /api/todos/{id}"],
    ]);
  });

  it("follows aliased imports, namespace imports and a custom transport", () => {
    const pages = pagesOf(
      {
        "src/lib/client.ts":
          "export async function request(path: string): Promise<unknown> { return fetch(path); }\n",
        "server/routes/api/x.get.ts": EMPTY_ROUTE,
        "src/pages/a.tsx":
          'import { request as send } from "../lib/client.ts";\n' +
          'export async function f(): Promise<void> { await send("/api/x"); }',
        "src/pages/b.tsx":
          'import * as client from "../lib/client.ts";\n' +
          'export async function g(): Promise<void> { await client.request("/api/x"); }',
      },
      { module: "src/lib/client.ts", exportName: "request" },
    ).pages;
    expect(pages.map((page) => page.calls[0]?.matchedRouteIds)).toEqual([
      ["route:GET /api/x"],
      ["route:GET /api/x"],
    ]);
  });

  it("flags a bare fetch even next to a custom transport", () => {
    const { diagnostics } = pagesOf(
      {
        "src/lib/client.ts":
          "export async function request(path: string): Promise<unknown> { return fetch(path); }\n",
        "src/pages/a.tsx":
          'import { request } from "../lib/client.ts";\n' +
          'export async function f(): Promise<void> { await request("/api/x"); return fetch("/api/x"); }',
      },
      { module: "src/lib/client.ts", exportName: "request" },
    );
    expect(diagnostics.map((item) => item.code)).toEqual(["client-transport"]);
  });

  it("excludes test files and keeps other src files with an empty call list", () => {
    const { pages, diagnostics } = pagesOf({
      "src/lib/api.ts": API_STUB,
      "src/pages/x.test.tsx":
        'export async function t(): Promise<unknown> { return fetch("/api/x"); }',
      "src/setup.ts": "export const ready = true;",
    });
    expect(pages.map((page) => page.path + " " + page.kind)).toEqual(["src/setup.ts other"]);
    expect(pages[0]?.calls).toEqual([]);
    expect(diagnostics).toEqual([]);
  });
});
