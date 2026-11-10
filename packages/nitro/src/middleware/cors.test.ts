import type { H3Event } from "nitro";
import { describe, expect, it, vi } from "vitest";

import type { RouteMetadata, RouteMetadataMap } from "../types.ts";

const state = vi.hoisted(() => ({
  config: { security: { trustedOrigins: ["https://studio.example"] } },
  routeMetadata: {} as RouteMetadataMap,
}));

vi.mock("#facilis/config", () => ({ default: state.config }));
vi.mock("#facilis/openapi-meta", () => ({ default: state.routeMetadata }));

import handler from "./cors.ts";

function route(overrides: Partial<RouteMetadata>): RouteMetadata {
  return {
    method: "GET",
    path: "/api/todos",
    dbTables: [],
    dbColumns: [],
    unresolved: [],
    warnings: [],
    ...overrides,
  };
}

function metadata(routes: readonly RouteMetadata[]): RouteMetadataMap {
  const map: Record<string, Record<string, RouteMetadata>> = {};
  for (const entry of routes) {
    (map[entry.path] ??= {})[entry.method.toLowerCase()] = entry;
  }
  return map;
}

Object.assign(
  state.routeMetadata,
  metadata([
    route({ method: "GET", path: "/api/todos" }),
    route({ method: "PATCH", path: "/api/todos/{id}" }),
    route({ method: "POST", path: "/api/webhooks", crossSite: true }),
  ]),
);

function makeEvent(url: string, method: string, headers: Record<string, string> = {}) {
  const request = new Request(url, { method, headers });
  const response = new Response(null);
  return { event: { req: request, res: response, context: {} } as unknown as H3Event, response };
}

describe("facilis-cors middleware", () => {
  it("sets a wildcard allow-origin for a crossSite route", () => {
    const harness = makeEvent("http://localhost/api/webhooks", "POST", {
      origin: "https://app.example",
    });

    handler(harness.event);

    expect(harness.response.headers.get("access-control-allow-origin")).toBe("*");
    expect(harness.response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("echoes a trusted origin on a same-origin route", () => {
    const harness = makeEvent("http://localhost/api/todos", "GET", {
      origin: "https://studio.example",
    });

    handler(harness.event);

    expect(harness.response.headers.get("access-control-allow-origin")).toBe(
      "https://studio.example",
    );
    expect(harness.response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(harness.response.headers.get("vary")).toBe("origin");
  });

  it("adds no CORS header for an untrusted origin", () => {
    const harness = makeEvent("http://localhost/api/todos", "GET", {
      origin: "https://evil.example",
    });

    handler(harness.event);

    expect(harness.response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("short-circuits a preflight with a 204 Response", () => {
    const harness = makeEvent("http://localhost/api/webhooks", "OPTIONS", {
      origin: "https://app.example",
      "access-control-request-method": "POST",
    });

    const result = handler(harness.event);

    expect(result).toBeInstanceOf(Response);
    expect(result?.status).toBe(204);
    expect(result?.headers.get("access-control-allow-origin")).toBe("*");
    expect(result?.headers.get("access-control-allow-methods")).toBe(
      "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    );
    // The event response is untouched: the returned Response replaces it.
    expect(harness.response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("leaves a plain OPTIONS request alone", () => {
    const harness = makeEvent("http://localhost/api/todos", "OPTIONS", {
      origin: "https://studio.example",
    });

    expect(handler(harness.event)).toBeUndefined();
  });
});
