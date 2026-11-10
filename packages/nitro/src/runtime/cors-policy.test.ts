import { describe, expect, it } from "vitest";

import type { RouteMetadata, RouteMetadataMap } from "../types.ts";
import { corsHeadersFor, matchRoute, preflightResponse } from "./cors-policy.ts";

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

const TRUSTED = ["https://studio.example"];

describe("matchRoute", () => {
  it("matches exact path segments", () => {
    const routes = metadata([route({ method: "GET", path: "/api/todos" })]);

    expect(matchRoute(routes, "/api/todos", "GET")?.path).toBe("/api/todos");
    expect(matchRoute(routes, "/api/todos/42", "GET")).toBeUndefined();
    expect(matchRoute(routes, "/api/other", "GET")).toBeUndefined();
  });

  it("matches a {name} segment against exactly one path segment", () => {
    const routes = metadata([route({ method: "PATCH", path: "/api/todos/{id}" })]);

    expect(matchRoute(routes, "/api/todos/42", "PATCH")?.method).toBe("PATCH");
    expect(matchRoute(routes, "/api/todos/42/items", "PATCH")).toBeUndefined();
    expect(matchRoute(routes, "/api/todos", "PATCH")).toBeUndefined();
  });

  it("matches a {*rest} segment against the remainder of the path", () => {
    const routes = metadata([route({ method: "GET", path: "/files/{*rest}" })]);

    expect(matchRoute(routes, "/files/a/b.txt", "GET")?.path).toBe("/files/{*rest}");
    expect(matchRoute(routes, "/files/", "GET")?.path).toBe("/files/{*rest}");
    expect(matchRoute(routes, "/other/a", "GET")).toBeUndefined();
  });

  it("compares methods case-insensitively", () => {
    const routes = metadata([route({ method: "GET", path: "/api/todos" })]);

    expect(matchRoute(routes, "/api/todos", "get")?.path).toBe("/api/todos");
    expect(matchRoute(routes, "/api/todos", "POST")).toBeUndefined();
  });

  it("does not treat literal path characters as pattern syntax", () => {
    const routes = metadata([route({ method: "GET", path: "/api/v1.0/health" })]);

    expect(matchRoute(routes, "/api/v1.0/health", "GET")?.path).toBe("/api/v1.0/health");
    expect(matchRoute(routes, "/api/v1x0/health", "GET")).toBeUndefined();
  });
});

describe("corsHeadersFor", () => {
  it("allows any origin without credentials for a crossSite route", () => {
    const headers = corsHeadersFor("https://app.example", true, route({ crossSite: true }));

    expect(headers.get("access-control-allow-origin")).toBe("*");
    expect(headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("echoes a trusted origin with credentials for same-origin routes", () => {
    const headers = corsHeadersFor("https://studio.example", true, route({}));

    expect(headers.get("access-control-allow-origin")).toBe("https://studio.example");
    expect(headers.get("access-control-allow-credentials")).toBe("true");
    expect(headers.get("vary")).toBe("origin");
  });

  it("emits no header for an untrusted origin", () => {
    expect(
      corsHeadersFor("https://evil.example", false, route({})).get("access-control-allow-origin"),
    ).toBeNull();
    expect(corsHeadersFor(null, false, route({}))).toEqual(new Headers());
  });
});

describe("preflightResponse", () => {
  it("answers 204 with a wildcard for a crossSite route", () => {
    const routes = metadata([route({ method: "POST", path: "/api/webhooks", crossSite: true })]);
    const request = new Headers({
      origin: "https://app.example",
      "access-control-request-method": "POST",
    });

    const response = preflightResponse(routes, "/api/webhooks", request, TRUSTED);

    expect(response?.status).toBe(204);
    expect(response?.headers.get("access-control-allow-origin")).toBe("*");
    expect(response?.headers.get("access-control-allow-credentials")).toBeNull();
    expect(response?.headers.get("access-control-allow-methods")).toBe(
      "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    );
    expect(response?.headers.get("access-control-allow-headers")).toBe("content-type");
    expect(response?.headers.get("access-control-max-age")).toBe("600");
  });

  it("echoes access-control-request-headers", () => {
    const routes = metadata([route({ method: "POST", path: "/api/webhooks", crossSite: true })]);
    const request = new Headers({
      origin: "https://app.example",
      "access-control-request-method": "POST",
      "access-control-request-headers": "x-signature, content-type",
    });

    const response = preflightResponse(routes, "/api/webhooks", request, TRUSTED);

    expect(response?.headers.get("access-control-allow-headers")).toBe("x-signature, content-type");
  });

  it("answers a trusted origin for a same-origin route with credentials", () => {
    const routes = metadata([route({ method: "GET", path: "/api/todos" })]);
    const request = new Headers({
      origin: "https://studio.example",
      "access-control-request-method": "GET",
    });

    const response = preflightResponse(routes, "/api/todos", request, TRUSTED);

    expect(response?.status).toBe(204);
    expect(response?.headers.get("access-control-allow-origin")).toBe("https://studio.example");
    expect(response?.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("resolves a parameterized path and an unusual method casing", () => {
    const routes = metadata([route({ method: "PATCH", path: "/api/todos/{id}" })]);
    const request = new Headers({
      origin: "https://studio.example",
      "access-control-request-method": "patch",
    });

    const response = preflightResponse(routes, "/api/todos/42", request, TRUSTED);

    expect(response?.status).toBe(204);
  });

  it("refuses an untrusted origin on a same-origin route", () => {
    const routes = metadata([route({ method: "GET", path: "/api/todos" })]);
    const request = new Headers({
      origin: "https://evil.example",
      "access-control-request-method": "GET",
    });

    expect(preflightResponse(routes, "/api/todos", request, TRUSTED)).toBeNull();
  });

  it("ignores a plain OPTIONS request without access-control-request-method", () => {
    const routes = metadata([route({ method: "GET", path: "/api/todos" })]);
    const request = new Headers({ origin: "https://studio.example" });

    expect(preflightResponse(routes, "/api/todos", request, TRUSTED)).toBeNull();
  });
});
